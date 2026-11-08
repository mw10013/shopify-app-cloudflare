/**
 * The pack's Playwright fixtures. Every browser is the agent Chrome over CDP, never one Playwright
 * launches: Shopify's bot check challenges a launched headless Chrome. Each test gets its own
 * context in it, under the exported Shopify admin login, closed after the test with its tabs; the
 * agent Chrome and other agents' tabs are left alone.
 *
 * @module
 */

import { AGENT_CDP } from "@mw10013/devkit/shopify/agent-chrome";
import { appFrame, awaitHydration, closeDevConsole } from "@mw10013/devkit/shopify/embedded-app";
import { routeAppToLocal } from "@mw10013/devkit/shopify/local-route";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  test as base,
  type Browser,
  type BrowserContext,
  chromium,
  type FrameLocator,
  type Locator,
  type Page,
} from "playwright/test";

import { E2eShopStatus } from "#internal/e2e-status.ts";

import { planSelectionUrl, screenError } from "./admin.ts";
import { appBaseUrl, E2eApp, type E2eOptions, statusUrl } from "./app.ts";

/** Reads the app's e2e status route for one shop. */
export type ShopStatusRead = (shop: string) => Promise<E2eShopStatus>;

const decodeApp = Schema.decodeUnknownSync(E2eApp);
const decodeStatus = Schema.decodeUnknownPromise(E2eShopStatus);

/** Reads `app`'s e2e status route for `shop`. */
export const readShopStatus = async (app: E2eApp, shop: string): Promise<E2eShopStatus> => {
  const url = statusUrl(app, shop);
  const response = await fetch(url, {
    headers: app.status.headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`GET ${url.pathname}?shop=${shop}: HTTP ${String(response.status)}`);
  return decodeStatus(await response.json());
};

/** The browser runs on this machine, so the app's tunnel is answered from its local port. */
const routeToServer = (context: BrowserContext, app: E2eApp) =>
  routeAppToLocal(context, {
    port: app.server.port,
    url: Option.some(app.server.tunnel),
    startedAt: Option.none(),
    log: "",
  });

/**
 * A context of its own in `browser` under the exported login, at the app's `baseURL` and routed to
 * `app`'s server, as the `context` fixture is: for a spec that outlives its server, since a context
 * is routed to one.
 */
export const adminContext = async (browser: Browser, app: E2eApp, adminAuthFile: string) => {
  const context = await browser.newContext({
    storageState: adminAuthFile,
    baseURL: appBaseUrl(app),
  });
  await routeToServer(context, app);
  return context;
};

export const test = base.extend<{ shopStatus: ShopStatusRead }, E2eOptions & { app: E2eApp }>({
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
  context: async ({ context, app }, use) => {
    await routeToServer(context, app);
    await use(context);
  },
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
    throw await screenError(page, "the app or its plan selection", cause);
  });
  if (landing === "PlanSelection") return { _tag: "PlanSelection" };
  await awaitHydration(frame, 15_000);
  await closeDevConsole(page);
  return { _tag: "App", frame };
};
