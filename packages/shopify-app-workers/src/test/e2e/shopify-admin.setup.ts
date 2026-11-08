/**
 * Exports the agent Chrome's Shopify login for the pack's specs on every run: a live read of
 * about a second, so no copy on disk is ever trusted stale. A lapsed login fails here, naming
 * what the person at the laptop runs.
 *
 * @module
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import { exportShopifyAdminAuth } from "@mw10013/devkit/shopify/agent-chrome";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import { test as setup } from "./fixtures.ts";

setup("shopify admin auth", async ({ app, adminAuthFile }) => {
  setup.setTimeout(60_000);
  if (adminAuthFile === undefined)
    throw new Error("No adminAuthFile: register the pack's projects with e2eProjects(app, root)");
  await Effect.runPromise(
    exportShopifyAdminAuth({ output: adminAuthFile, store: app.store }).pipe(
      Effect.tap((count) => Console.log(`Wrote ${String(count)} cookies to ${adminAuthFile}`)),
      Effect.provide(NodeServices.layer),
    ),
  );
});
