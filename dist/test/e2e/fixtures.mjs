import { E2eShopStatus, E2eWebhookDeliveries } from "../../internal/e2e-status.mjs";
import { E2eApp, appBaseUrl, statusUrl, webhookRecordUrl } from "./app.mjs";
import { onLeasedStore, planSelectionUrl, requireLeasedStore, screenError } from "./admin.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { appFrame, awaitHydration, closeDevConsole } from "@mw10013/devkit/shopify/embedded-app";
import { chromium, expect as expect$1, test } from "playwright/test";
import process from "node:process";
import { AGENT_CDP } from "@mw10013/devkit/shopify/agent-chrome";
import { routeAppToLocal } from "@mw10013/devkit/shopify/local-route";
// src/test/e2e/fixtures.ts
/**
* The pack's Playwright fixtures. Every browser is the agent Chrome over CDP, never one Playwright
* launches: Shopify's bot check challenges a launched headless Chrome. Each test gets its own
* context in it, under the exported Shopify admin login, closed after the test with its tabs; the
* agent Chrome and other agents' tabs are left alone. A failed test's snapshot is of its own pages
* on the leased store only, never of Playwright's choosing, which would be another agent's tab.
*
* @module
*/
const decodeApp = Schema.decodeUnknownSync(E2eApp);
const decodeStatus = Schema.decodeUnknownPromise(E2eShopStatus);
const decodeDeliveries = Schema.decodeUnknownPromise(E2eWebhookDeliveries);
/**
* GETs `url`, on the e2e server's local port (`localServerUrl`), with the status route's headers, and
* answers its JSON body. A redirect fails the read, since it would carry the token elsewhere.
*/
const getLocalJson = async (app, url, name) => {
	const response = await fetch(url, {
		headers: app.status.headers,
		redirect: "error",
		signal: AbortSignal.timeout(1e4)
	});
	if (!response.ok) throw new Error(`GET ${name}: HTTP ${String(response.status)}`);
	return response.json();
};
/** Reads `app`'s e2e status route for `shop`. */
const readShopStatus = async (app, shop) => {
	const url = statusUrl(app, shop);
	return decodeStatus(await getLocalJson(app, url, `${url.pathname}?shop=${shop}`));
};
/** Reads `app`'s e2e webhook record: the requests its Backend answered under `/webhooks/`. */
const readWebhookDeliveries = async (app) => {
	const url = webhookRecordUrl(app);
	return decodeDeliveries(await getLocalJson(app, url, url.pathname));
};
/** The browser runs on this machine, so the app's tunnel is answered from its local port. */
const routeToServer = (context, app) => routeAppToLocal(context, {
	port: app.server.port,
	url: Option.some(app.server.tunnel),
	startedAt: Option.none(),
	log: ""
});
/**
* The contexts this worker's specs opened in the agent Chrome, until each closes. Never the
* default context of the CDP connection, whose tabs are other agents'.
*/
const ownContexts = /* @__PURE__ */ new Set();
const own = (context) => {
	ownContexts.add(context);
	context.once("close", () => ownContexts.delete(context));
	return context;
};
/**
* Attaches a snapshot of each page in `contexts` to a failed test, for what Playwright's own error
* context would have shown. A page on any other site than the leased store's admin is named by
* its origin only, since it could be another agent's store.
*/
const attachFailureSnapshots = async (testInfo, app, contexts) => {
	if (testInfo.status === testInfo.expectedStatus) return;
	const pages = [...contexts].flatMap((context) => context.pages());
	for (const [index, page] of pages.entries()) {
		const body = onLeasedStore(page, app) ? `${page.url()}\n\n${await page.ariaSnapshot({ timeout: 5e3 }).catch(() => "(no snapshot)")}` : `Not captured: the page is at ${URL.canParse(page.url()) ? new URL(page.url()).origin : "(no URL)"}, not ${app.store}'s admin, so it may be another agent's store.`;
		await testInfo.attach(`page ${String(index + 1)}`, {
			body,
			contentType: "text/plain"
		});
	}
};
/**
* A context of its own in `browser` under the exported login, at the app's `baseURL` and routed to
* `app`'s server, as the `context` fixture is: for a spec that outlives its server, since a context
* is routed to one. A failed test gets its pages' snapshots, and the context closes after the
* test if the spec has not closed it.
*/
const adminContext = async (browser, app, adminAuthFile) => {
	const context = own(await browser.newContext({
		storageState: adminAuthFile,
		baseURL: appBaseUrl(app)
	}));
	await routeToServer(context, app);
	return context;
};
const test$1 = test.extend({
	e2eApp: [void 0, {
		option: true,
		scope: "worker"
	}],
	adminAuthFile: [void 0, {
		option: true,
		scope: "worker"
	}],
	app: [async ({ e2eApp }, use) => {
		if (e2eApp === void 0) throw new Error("No e2eApp: register the pack's projects with e2eProjects(app, root)");
		await use(decodeApp(e2eApp));
	}, { scope: "worker" }],
	browser: [async ({}, use) => {
		process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
		const browser = await chromium.connectOverCDP(AGENT_CDP, { noDefaults: true });
		await use(browser);
		await browser.close();
	}, { scope: "worker" }],
	context: async ({ context, app }, use, testInfo) => {
		own(context);
		await routeToServer(context, app);
		await use(context);
		await attachFailureSnapshots(testInfo, app, [context]);
	},
	ownContextsTeardown: [async ({ app }, use, testInfo) => {
		await use(void 0);
		const left = [...ownContexts];
		await attachFailureSnapshots(testInfo, app, left);
		await Promise.all(left.map((context) => context.close().catch(() => void 0)));
	}, { auto: true }],
	shopStatus: async ({ app }, use) => {
		await use((shop) => readShopStatus(app, shop));
	}
});
/**
* Opens the app in the store's admin (`baseURL` + `path`) and waits for where it lands: the app's
* frame showing `ready` (a locator inside it), hydrated, with the Dev Console collapsed; or
* {@link planSelectionUrl}, where the merchant gate sends a store with no plan. It navigates with
* `waitUntil: "commit"`, because the admin redirects at once to re-run the embed handshake.
*/
const openApp = async (page, app, ready, path = "") => {
	await page.goto(path, { waitUntil: "commit" });
	const frame = appFrame(page);
	const timeout = 3e4;
	const landing = await Promise.race([ready(frame).waitFor({
		state: "attached",
		timeout
	}).then(() => "App"), page.waitForURL((url) => url.href.startsWith(planSelectionUrl(app)), {
		timeout,
		waitUntil: "commit"
	}).then(() => "PlanSelection")]).catch(async (cause) => {
		throw await screenError(page, app, "the app or its plan selection", cause);
	});
	requireLeasedStore(page, app);
	if (landing === "PlanSelection") return { _tag: "PlanSelection" };
	await awaitHydration(frame, 15e3);
	requireLeasedStore(page, app);
	await closeDevConsole(page);
	return {
		_tag: "App",
		frame
	};
};
export { adminContext, expect$1 as expect, openApp, planSelectionUrl, readShopStatus, readWebhookDeliveries, test$1 as test };
