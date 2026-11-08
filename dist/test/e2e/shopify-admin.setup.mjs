import { test } from "./fixtures.mjs";
import * as Effect from "effect/Effect";
import { exportShopifyAdminAuth } from "@mw10013/devkit/shopify/agent-chrome";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
// src/test/e2e/shopify-admin.setup.ts
/**
* Exports the agent Chrome's Shopify login for the pack's specs on every run: a live read of
* about a second, so no copy on disk is ever trusted stale. A lapsed login fails here, naming
* what the person at the laptop runs.
*
* @module
*/
test("shopify admin auth", async ({ app, adminAuthFile }) => {
	test.setTimeout(6e4);
	if (adminAuthFile === void 0) throw new Error("No adminAuthFile: register the pack's projects with e2eProjects(app, root)");
	await Effect.runPromise(exportShopifyAdminAuth({
		output: adminAuthFile,
		store: app.store
	}).pipe(Effect.tap((count) => Console.log(`Wrote ${String(count)} cookies to ${adminAuthFile}`)), Effect.provide(NodeServices.layer)));
});
export {};
