import path from "node:path";

import { app } from "@mw10013/rigging/core/app";
import { e2eProject } from "@mw10013/shopify-app-workers/test/e2e";
import { shopifyE2eConfig } from "@mw10013/shopify-app-workers/test/e2e/config";
import { defineConfig } from "playwright/test";

import { catalog } from "#backend/app.ts";
import { STORE_SCOPES } from "#scripts/lib/store-auth.ts";

const { root } = app(import.meta.dirname);

/**
 * The catalog's plans, cheapest first, with their names on the Partner Dashboard, which head their
 * cards on Shopify's plan selection page.
 */
const PLANS = [
  { handle: "testbed-basic", name: "Testbed Basic" },
  { handle: "testbed-pro", name: "Testbed Pro" },
] as const;
if (PLANS.map(({ handle }) => handle).join(",") !== catalog.handles.join(","))
  throw new Error(
    `playwright.config.ts names plans the catalog does not sell: ${catalog.handles.join(", ")}`,
  );

const { app: testbed, config } = shopifyE2eConfig({
  root,
  plans: PLANS,
  // shop/update only logs, so Shopify's sample of it is safe to deliver.
  webhookTopics: ["shop/update"],
  storeScopes: STORE_SCOPES,
});

/**
 * Runs the package's end-to-end spec pack and the testbed's own specs against this checkout's
 * long-lived e2e server (`vp run e2e:start`, `scripts/e2e.ts`) in the agent Chrome.
 */
export default defineConfig({
  ...config,
  projects: [
    ...config.projects,
    e2eProject(testbed, root, {
      name: "testbed",
      testDir: path.join(root, "test/e2e"),
      testMatch: /\.spec\.ts$/u,
    }),
  ],
});
