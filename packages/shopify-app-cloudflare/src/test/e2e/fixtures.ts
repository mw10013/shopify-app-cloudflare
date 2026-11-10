/**
 * The pack's Playwright fixtures. Every browser is the agent Chrome over CDP, never one Playwright
 * launches: Shopify's bot check challenges a launched headless Chrome. Each test gets its own
 * context in it, under the exported Shopify admin login, closed after the test with its tabs; the
 * agent Chrome and other agents' tabs are left alone. A failed test's snapshot is of its own pages
 * on the leased store only, never of Playwright's choosing, which would be another agent's tab.
 *
 * @module
 */

import process from "node:process";

import * as Schema from "effect/Schema";
import {
  test as base,
  type Browser,
  type BrowserContext,
  chromium,
  type FrameLocator,
  type Locator,
  type Page,
  type TestInfo,
} from "playwright/test";

import { AGENT_CDP } from "#dev/agent-chrome.ts";
import { appFrame, awaitHydration, closeDevConsole } from "#dev/embedded-app.ts";
import { routeAppToLocal } from "#dev/local-route.ts";
import { E2eShopStatus, E2eWebhookDeliveries } from "#internal/e2e-status.ts";

import { onLeasedStore, planSelectionUrl, requireLeasedStore, screenError } from "./admin.ts";
import { appBaseUrl, E2eApp, type E2eOptions, statusUrl, webhookRecordUrl } from "./app.ts";

/** Reads the app's e2e status route for one shop. */
export type ShopStatusRead = (shop: string) => Promise<E2eShopStatus>;

const decodeApp = Schema.decodeUnknownSync(E2eApp);
const decodeStatus = Schema.decodeUnknownPromise(E2eShopStatus);
const decodeDeliveries = Schema.decodeUnknownPromise(E2eWebhookDeliveries);

/**
 * GETs `url`, on the e2e server's local port (`localServerUrl`), with the status route's headers, and
 * answers its JSON body. A redirect fails the read, since it would carry the token elsewhere.
 */
const getLocalJson = async (app: E2eApp, url: URL, name: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: app.status.headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GET ${name}: HTTP ${String(response.status)}`);
  return response.json();
};

/** Reads `app`'s e2e status route for `shop`. */
export const readShopStatus = async (app: E2eApp, shop: string): Promise<E2eShopStatus> => {
  const url = statusUrl(app, shop);
  return decodeStatus(await getLocalJson(app, url, `${url.pathname}?shop=${shop}`));
};

/** Reads `app`'s e2e webhook record: the requests its Backend answered under `/webhooks/`. */
export const readWebhookDeliveries = async (app: E2eApp): Promise<E2eWebhookDeliveries> => {
  const url = webhookRecordUrl(app);
  return decodeDeliveries(await getLocalJson(app, url, url.pathname));
};

/** The browser runs on this machine, so the app's tunnel is answered from its local port. */
const routeToServer = (context: BrowserContext, app: E2eApp) =>
  routeAppToLocal(context, app.server);

/**
 * The contexts this worker's specs opened in the agent Chrome, until each closes. Never the
 * default context of the CDP connection, whose tabs are other agents'.
 */
const ownContexts = new Set<BrowserContext>();

const own = (context: BrowserContext) => {
  ownContexts.add(context);
  context.once("close", () => ownContexts.delete(context));
  return context;
};

/**
 * Attaches a snapshot of each page in `contexts` to a failed test, for what Playwright's own error
 * context would have shown. A page on any other site than the leased store's admin is named by
 * its origin only, since it could be another agent's store.
 */
const attachFailureSnapshots = async (
  testInfo: TestInfo,
  app: E2eApp,
  contexts: Iterable<BrowserContext>,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const pages = [...contexts].flatMap((context) => context.pages());
  for (const [index, page] of pages.entries()) {
    const body = onLeasedStore(page, app)
      ? `${page.url()}\n\n${await page.ariaSnapshot({ timeout: 5000 }).catch(() => "(no snapshot)")}`
      : `Not captured: the page is at ${URL.canParse(page.url()) ? new URL(page.url()).origin : "(no URL)"}, not ${app.store}'s admin, so it may be another agent's store.`;
    await testInfo.attach(`page ${String(index + 1)}`, { body, contentType: "text/plain" });
  }
};

/**
 * A context of its own in `browser` under the exported login, at the app's `baseURL` and routed to
 * `app`'s server, as the `context` fixture is: for a spec that outlives its server, since a context
 * is routed to one. A failed test gets its pages' snapshots, and the context closes after the
 * test if the spec has not closed it.
 */
export const adminContext = async (browser: Browser, app: E2eApp, adminAuthFile: string) => {
  const context = own(
    await browser.newContext({
      storageState: adminAuthFile,
      baseURL: appBaseUrl(app),
    }),
  );
  await routeToServer(context, app);
  return context;
};

export const test = base.extend<
  { shopStatus: ShopStatusRead; ownContextsTeardown: undefined },
  E2eOptions & { app: E2eApp }
>({
  e2eApp: [undefined, { option: true, scope: "worker" }],
  adminAuthFile: [undefined, { option: true, scope: "worker" }],
  app: [
    async ({ e2eApp }, use) => {
      if (e2eApp === undefined)
        throw new Error("No e2eApp: register the pack's projects with e2eProjects(app, root)");
      await use(decodeApp(e2eApp));
    },
    { scope: "worker" },
  ],
  browser: [
    // Playwright reads a fixture's dependencies from this pattern, so it must be `{}`, not `_`.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // A failed test's error context would otherwise hold an aria snapshot of the first tab of
      // the first context Playwright closes, which over CDP is the agent Chrome's default
      // context, another agent's tab. Playwright reads this in the worker as each test ends; every
      // spec that reaches the agent Chrome connects here first, in every project and load mode.
      process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
      // `noDefaults` leaves the browser's download behavior and other agents' tabs alone: no
      // focus or media emulation is applied to the tabs already open.
      const browser = await chromium.connectOverCDP(AGENT_CDP, { noDefaults: true });
      await use(browser);
      // Closing a browser connected over CDP closes the contexts it made and disconnects; the
      // agent Chrome keeps running.
      await browser.close();
    },
    { scope: "worker" },
  ],
  context: async ({ context, app }, use, testInfo) => {
    own(context);
    await routeToServer(context, app);
    await use(context);
    await attachFailureSnapshots(testInfo, app, [context]);
  },
  // Set up before every other test fixture, so torn down after them: the contexts a spec opened
  // with {@link adminContext} and left open.
  ownContextsTeardown: [
    async ({ app }, use, testInfo) => {
      await use(undefined);
      const left = [...ownContexts];
      await attachFailureSnapshots(testInfo, app, left);
      await Promise.all(left.map((context) => context.close().catch(() => undefined)));
    },
    { auto: true },
  ],
  shopStatus: async ({ app }, use) => {
    await use((shop) => readShopStatus(app, shop));
  },
});
export { expect } from "playwright/test";
export { planSelectionUrl } from "./admin.ts";

/** Where opening the app lands: the app itself, or plan selection for a store with no plan. */
export type AppLanding =
  | { readonly _tag: "App"; readonly frame: FrameLocator }
  | { readonly _tag: "PlanSelection" };

/**
 * Opens the app in the store's admin (`baseURL` + `path`) and waits for where it lands: the app's
 * frame showing `ready` (a locator inside it), hydrated, with the Dev Console collapsed; or
 * {@link planSelectionUrl}, where the merchant gate sends a store with no plan. It navigates with
 * `waitUntil: "commit"`, because the admin redirects at once to re-run the embed handshake.
 */
export const openApp = async (
  page: Page,
  app: E2eApp,
  ready: (frame: FrameLocator) => Locator,
  path = "",
): Promise<AppLanding> => {
  await page.goto(path, { waitUntil: "commit" });
  const frame = appFrame(page);
  const timeout = 30_000;
  // The loser's wait rejects later, into the race's own handler.
  const landing = await Promise.race([
    ready(frame)
      .waitFor({ state: "attached", timeout })
      .then(() => "App" as const),
    page
      .waitForURL((url) => url.href.startsWith(planSelectionUrl(app)), {
        timeout,
        waitUntil: "commit",
      })
      .then(() => "PlanSelection" as const),
  ]).catch(async (cause: unknown) => {
    throw await screenError(page, app, "the app or its plan selection", cause);
  });
  requireLeasedStore(page, app);
  if (landing === "PlanSelection") return { _tag: "PlanSelection" };
  await awaitHydration(frame, 15_000);
  requireLeasedStore(page, app);
  await closeDevConsole(page);
  return { _tag: "App", frame };
};
