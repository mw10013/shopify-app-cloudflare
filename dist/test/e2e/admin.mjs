import { E2eServer } from "./app.mjs";
import * as Schema from "effect/Schema";
import { appFrame } from "@mw10013/devkit/shopify/embedded-app";
import { execFile } from "node:child_process";
import { expect } from "playwright/test";
// src/test/e2e/admin.ts
/**
* The Shopify admin screens the lifecycle drives: the app's install page, its plan selection and
* approval pages, and its page under Settings > Apps. Every wait that times out names the screen
* Shopify showed instead and what the owner does about it, so a run never loops on a login page, a
* bot check or a screen Shopify changed. The wording and structure were read from the admin on
* 2026-11-08 on a development store of the app's own organization.
*
* @module
*/
/** A Shopify screen the suite cannot get past by itself; its message says what the owner does. */
var ShopifyScreenError = class extends Error {
	name = "ShopifyScreenError";
};
const SCREEN_TIMEOUT = 3e4;
const LANDING_POLL = 500;
/** The admin's own pages for the store. */
const adminUrl = (app, path) => `https://admin.shopify.com/store/${app.store}${path}`;
/**
* The admin install URL: Shopify's install page for an app the store lacks, else a redirect into
* the app.
*/
const installUrl = (app) => adminUrl(app, `/oauth/install?client_id=${encodeURIComponent(app.clientId)}`);
/** Where the admin sends a store with no plan, and where a merchant changes plan. */
const planSelectionUrl = (app) => adminUrl(app, `/charges/${app.appHandle}/pricing_plans`);
const visible = (locator) => locator.first().isVisible().catch(() => false);
/**
* The store `page` shows when it is another than the leased one. The admin falls back to the
* login's last-used store for a URL that names none, and the agent Chrome's login is every
* checkout's, so that can be any agent's store.
*/
const foreignStore = (page, app) => {
	const store = /^https:\/\/admin\.shopify\.com\/store\/(?<store>[^/?#]+)/u.exec(page.url())?.groups?.store;
	return store !== void 0 && store !== app.store ? store : void 0;
};
/**
* The error for a page on `store`, another than the leased one. It names the two stores only:
* nothing of the foreign store's page (its URL, title or content) leaves the browser.
*/
const isolationError = (store, app, cause) => new ShopifyScreenError(`The admin switched to ${store}, which this checkout does not lease (it leases ${app.store}); the suite stops before acting or capturing anything there.`, { cause });
/** Fails before the suite acts on any store but the leased one. */
const requireLeasedStore = (page, app) => {
	const store = foreignStore(page, app);
	if (store !== void 0) throw isolationError(store, app);
};
/**
* Whether `page` shows the leased store's admin, the only page the suite may capture: a failure's
* snapshot of any other page could hold another agent's store.
*/
const onLeasedStore = (page, app) => {
	const url = page.url();
	const admin = `https://admin.shopify.com/store/${app.store}`;
	return url === admin || url.startsWith(admin) && /^[/?#]/u.test(url.slice(admin.length));
};
/**
* Names the screen `page` shows when a wait for `expected` timed out: a page on another store than
* the leased one is named by its store alone ({@link requireLeasedStore}); a lapsed login and
* Shopify's connection check need the owner; anything else is quoted by its URL, title and first
* heading, for the owner to look at in the agent Chrome.
*/
const screenError = async (page, app, expected, cause) => {
	const store = foreignStore(page, app);
	if (store !== void 0) return isolationError(store, app, cause);
	const url = page.url();
	const title = await page.title().catch(() => "");
	if (new URL(url).hostname === "accounts.shopify.com" || title.startsWith("Log in")) return new ShopifyScreenError(`Waiting for ${expected}, the agent Chrome landed on Shopify's login page: its Shopify login lapsed. The owner signs it in again with vp run browser login, then reruns.`, { cause });
	if (await visible(page.getByText(/connection needs to be verified|verify you are human/iu))) return new ShopifyScreenError(`Waiting for ${expected}, Shopify's connection check held the agent Chrome at ${url}. Rerun in a few minutes; if it persists, the owner passes the check in the agent Chrome (vp run browser login).`, { cause });
	if (await visible(page.getByText(/too many requests|rate limit/iu))) return new ShopifyScreenError(`Waiting for ${expected}, Shopify rate limited the agent Chrome at ${url}. Rerun in a few minutes.`, { cause });
	const heading = await page.getByRole("heading").first().textContent({ timeout: 1e3 }).catch(() => null);
	return new ShopifyScreenError(`Waiting for ${expected}, Shopify showed an unexpected screen: ${url} titled "${title}"${heading === null ? "" : `, heading "${heading.trim()}"`}. The owner opens it in the agent Chrome to see what changed.`, { cause });
};
/**
* Waits for `locator` on the leased store's admin, failing with the {@link screenError} for
* `expected` when it never shows.
*/
const awaitScreen = async (page, app, locator, expected, timeout = SCREEN_TIMEOUT) => {
	await locator.first().waitFor({ timeout }).catch(async (cause) => {
		throw await screenError(page, app, expected, cause);
	});
	requireLeasedStore(page, app);
};
/**
* One wait over the screens opening the app can land on, each read as soon as it shows: Shopify's
* install page, plan selection, or the app's frame, which loads the tunnel when the CLI's dev
* preview serves the store and the app's released URL when none does.
*/
const awaitLanding = async (page, app) => {
	const tunnel = new URL(app.server.tunnel).origin;
	const install = page.getByRole("heading", {
		name: "Install app",
		level: 1
	});
	const frame = page.locator("iframe[src*=\"embedded=1\"]:not([src*=\"chrome=window\"])");
	const ready = appFrame(page).getByTestId("shop");
	const read = async () => {
		requireLeasedStore(page, app);
		if (page.url().startsWith(planSelectionUrl(app))) return { _tag: "PlanSelection" };
		if (await visible(install)) return { _tag: "Installing" };
		if (await frame.count() > 0) {
			const src = await frame.first().getAttribute("src") ?? "";
			if (src !== "" && new URL(src).origin !== tunnel) return {
				_tag: "DevPreviewEnded",
				src
			};
			if (await ready.count() > 0) return { _tag: "App" };
		}
	};
	let landing;
	for (let polls = SCREEN_TIMEOUT / LANDING_POLL; landing === void 0 && polls > 0; polls--) {
		landing = await read();
		if (landing === void 0) await page.waitForTimeout(LANDING_POLL);
	}
	if (landing === void 0) throw await screenError(page, app, "the app, its plan selection or its install page");
	return landing;
};
/** Clicks Install on Shopify's install page and waits to leave it. */
const approveInstall = async (page, app) => {
	requireLeasedStore(page, app);
	await page.getByRole("main").getByRole("button", {
		name: "Install",
		exact: true
	}).click();
	await page.waitForURL((url) => !url.pathname.includes("/app/grant") && !url.pathname.includes("/oauth/"), {
		timeout: SCREEN_TIMEOUT,
		waitUntil: "commit"
	}).catch(async (cause) => {
		throw await screenError(page, app, "the admin to leave the install page", cause);
	});
	requireLeasedStore(page, app);
};
/**
* A plan's card on the plan selection page: the outermost ancestor of its name's heading that
* holds no other plan's heading.
*/
const planCard = (page, plan) => page.getByRole("heading", {
	name: plan.name,
	exact: true,
	level: 3
}).locator("xpath=ancestor::*[count(.//*[self::h3 or @aria-level=\"3\"]) = 1][last()]");
/**
* The plan the plan selection page marks "Current", if any. A cancelled subscription is marked by
* none, though it runs until its period ends.
*/
const currentPlan = async (page, app) => {
	if (!page.url().startsWith(planSelectionUrl(app))) await page.goto(planSelectionUrl(app), { waitUntil: "commit" });
	await awaitScreen(page, app, planCard(page, app.plans[0]), "the plans on plan selection");
	for (const plan of app.plans) if (await visible(planCard(page, plan).getByText("Current", { exact: true }))) return plan;
};
/**
* Shopify's wording on a development store of the app's own organization, where every plan is a
* test charge: the card's "Test with this plan" and the charge's "Approve". A live store reads
* "Select" or "Choose"; neither runs here, since a pool store never goes live.
*/
const PLAN_BUTTON = /^(?:Test with this plan|Select plan|Select|Choose plan|Choose)$/u;
/**
* Subscribes the store to `plan` through Shopify's plan selection page, approving the test
* charge, and waits for Shopify to send the merchant back into the app. Answers `false`, changing
* nothing, when the page already marks `plan` "Current". A plan card offers no button for the
* current plan.
*/
const choosePlan = async (page, app, plan) => {
	if (!page.url().startsWith(planSelectionUrl(app))) await page.goto(planSelectionUrl(app), { waitUntil: "commit" });
	const card = planCard(page, plan);
	await awaitScreen(page, app, card, `the "${plan.name}" card on plan selection`);
	const button = card.getByRole("button", { name: PLAN_BUTTON });
	if (await button.count() === 0) {
		if (await visible(card.getByText("Current", { exact: true }))) return false;
		throw await screenError(page, app, `a button on the "${plan.name}" card`);
	}
	requireLeasedStore(page, app);
	await button.first().click();
	await awaitScreen(page, app, page.getByRole("heading", { name: "Approve charge" }), `the charge approval page for ${plan.name}`);
	await page.getByRole("button", {
		name: "Approve",
		exact: true
	}).click();
	await page.waitForURL((url) => url.pathname.startsWith(`/store/${app.store}/apps/${app.appHandle}/`), {
		timeout: 6e4,
		waitUntil: "commit"
	}).catch(async (cause) => {
		throw await screenError(page, app, `the app after approving ${plan.name}`, cause);
	});
	return true;
};
/**
* Uninstalls the app through Settings > Apps: the app's row, its Uninstall app button, and the
* dialog, which enables Uninstall only once a reason is ticked. The reasons open in a popover over
* the dialog's buttons, closed by a click on the dialog's heading.
*/
const uninstall = async (page, app) => {
	await page.goto(adminUrl(app, "/settings/apps"), { waitUntil: "commit" });
	const row = page.locator(`a[href*="/settings/apps/app_installations/app/${app.appHandle}"]`);
	await awaitScreen(page, app, row, `the app's row in Settings > Apps`);
	await row.first().click();
	const open = page.getByRole("region", { name: "Settings" }).getByRole("button", { name: "Uninstall app" });
	await awaitScreen(page, app, open, "the app's Uninstall app button");
	await open.first().click();
	const dialog = page.getByRole("dialog", { name: /^Uninstall /u });
	await awaitScreen(page, app, dialog, "the uninstall dialog");
	await dialog.getByRole("button", { name: "Select all that apply" }).click();
	const reason = page.getByRole("checkbox", { name: "Testing multiple apps" });
	await awaitScreen(page, app, reason, "the uninstall reasons");
	await reason.check();
	await expect(async () => {
		requireLeasedStore(page, app);
		await dialog.getByRole("heading", { level: 2 }).first().click();
		await expect(reason).toBeHidden({ timeout: 1e3 });
	}).toPass({ timeout: 1e4 });
	requireLeasedStore(page, app);
	await dialog.getByRole("button", {
		name: "Uninstall",
		exact: true
	}).click();
	await awaitScreen(page, app, page.getByRole("heading", { name: /successfully uninstalled/iu }), "Shopify to confirm the uninstall");
};
const SERVER_RESTART_TIMEOUT = 3e5;
const decodeServer = Schema.decodeUnknownSync(Schema.fromJsonString(E2eServer));
/**
* Restarts the e2e server with the app's {@link E2eApp} `restart` command and answers the app on
* the new server.
*/
const restartServer = async (app) => {
	const [command, ...args] = app.restart.command;
	const last = (await new Promise((resolve, reject) => {
		execFile(command, args, {
			cwd: app.restart.cwd,
			timeout: SERVER_RESTART_TIMEOUT,
			maxBuffer: 16777216
		}, (error, out, err) => {
			if (error === null) resolve(out);
			else reject(new Error(`${app.restart.command.join(" ")} failed: ${error.message}\n${out}\n${err}`, { cause: error }));
		});
	})).trim().split("\n").at(-1) ?? "";
	return {
		...app,
		server: decodeServer(last)
	};
};
export { ShopifyScreenError, adminUrl, approveInstall, awaitLanding, awaitScreen, choosePlan, currentPlan, installUrl, onLeasedStore, planSelectionUrl, requireLeasedStore, restartServer, screenError, uninstall };
