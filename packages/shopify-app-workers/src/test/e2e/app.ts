/**
 * The end-to-end spec pack's app adapter and its Playwright projects. An app registers the pack
 * from its own `playwright.config.ts`: it describes itself as an {@link E2eApp} and spreads
 * {@link e2eProjects} into its `projects`, with {@link E2E_PREFLIGHT} as a `globalSetup`.
 *
 * @module
 */

import path from "node:path";

import { storageStatePath } from "@mw10013/devkit/shopify/agent-chrome";
import * as Schema from "effect/Schema";
import type { PlaywrightTestProject } from "playwright/test";

/**
 * What the pack needs of an app: its leased store, its handle and plans, its running e2e server
 * and how to read the server's e2e status route. Plain data, because Playwright hands project
 * options to the preflight and to every worker.
 */
export const E2eApp = Schema.Struct({
  /** The leased store's handle: `<store>` in `<store>.myshopify.com` and in admin URLs. */
  store: Schema.NonEmptyString,
  /** The app's handle, which names it in admin URLs: `/apps/<handle>`, `/charges/<handle>`. */
  appHandle: Schema.NonEmptyString,
  /** The app's plan handles, as its `PlanCatalog` sells them. */
  plans: Schema.NonEmptyArray(Schema.NonEmptyString),
  /** The e2e server: its local port, which the browser and the status reads use, and its tunnel. */
  server: Schema.Struct({ port: Schema.Int, tunnel: Schema.NonEmptyString }),
  /**
   * The e2e status route on the local port, answering `GET <url>?shop=<shop>` with an
   * `E2eShopStatus` when sent `headers`.
   */
  status: Schema.Struct({
    url: Schema.NonEmptyString,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  /** The store auth scopes the app's suite needs; the preflight checks them when any are given. */
  storeScopes: Schema.Array(Schema.NonEmptyString),
});
export type E2eApp = typeof E2eApp.Type;

/**
 * The worker options every pack project carries: the app it runs against and where the exported
 * Shopify admin login lives.
 */
export interface E2eOptions {
  readonly e2eApp: E2eApp | undefined;
  readonly adminAuthFile: string | undefined;
}

/** The store's myshopify domain, the `shop` every Shopify surface names it by. */
export const shopOf = (app: E2eApp) => `${app.store}.myshopify.com`;

/** The pack's spec and setup files. */
export const E2E_SPECS_DIR = import.meta.dirname;

/** The run's preflight, for the app's `globalSetup`. */
export const E2E_PREFLIGHT = path.join(import.meta.dirname, "preflight.ts");

/** The project that exports the agent Chrome's Shopify login; the pack's specs depend on it. */
export const SHOPIFY_ADMIN_PROJECT = "shopify-admin";

/**
 * The pack's projects: {@link SHOPIFY_ADMIN_PROJECT}, then its specs inside the store's admin.
 * `root` is the app's directory, which holds the exported login under `playwright/.auth/`.
 */
export const e2eProjects = (
  app: E2eApp,
  root: string,
): PlaywrightTestProject<object, E2eOptions>[] => {
  const adminAuthFile = path.join(root, storageStatePath);
  return [
    {
      name: SHOPIFY_ADMIN_PROJECT,
      testDir: E2E_SPECS_DIR,
      testMatch: /shopify-admin\.setup\.ts$/u,
      use: { e2eApp: app, adminAuthFile },
    },
    {
      name: "shopify-app-workers",
      testDir: E2E_SPECS_DIR,
      testMatch: /\.spec\.ts$/u,
      dependencies: [SHOPIFY_ADMIN_PROJECT],
      timeout: 60_000,
      expect: { timeout: 10_000 },
      use: {
        e2eApp: app,
        adminAuthFile,
        baseURL: `https://admin.shopify.com/store/${app.store}/apps/${app.appHandle}`,
        storageState: adminAuthFile,
        actionTimeout: 10_000,
        navigationTimeout: 30_000,
        trace: "retain-on-failure",
      },
    },
  ];
};
