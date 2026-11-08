/**
 * The end-to-end spec pack's app adapter and its Playwright projects. An app registers the pack
 * from its own `playwright.config.ts`: it describes itself as an {@link E2eApp} and spreads
 * {@link e2eProjects} into its `projects`, with {@link E2E_PREFLIGHT} as a `globalSetup`.
 *
 * @module
 */

import path from "node:path";
import process from "node:process";

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

/**
 * The run's preflight, for the app's `globalSetup`. Its extension is this module's, so the path
 * holds both in the source (`.ts`) and in the built package, whose JavaScript Playwright loads
 * as is: it does not transpile TypeScript under `node_modules`.
 */
export const E2E_PREFLIGHT = path.join(
  import.meta.dirname,
  `preflight${path.extname(import.meta.filename)}`,
);

/** A spec file, as source or built: `.spec.ts`, `.spec.js`, `.spec.mjs` and the like. */
export const SPEC_MATCH = /\.spec\.[cm]?[jt]s$/u;

/** The project that exports the agent Chrome's Shopify login; the pack's specs depend on it. */
export const SHOPIFY_ADMIN_PROJECT = "shopify-admin";

/** Set to `1` to keep a trace of each failed test. */
export const E2E_TRACE = "E2E_TRACE";

/**
 * Whether this run keeps traces. Off by default: a trace holds the context's storage state (the
 * live Shopify admin login) in its context options and the login's cookies in its network log,
 * and the HTML report copies traces. `E2E_TRACE=1` opts in, with a warning from the main process.
 */
const traced = () => {
  if (process.env[E2E_TRACE] !== "1") return false;
  if (process.env.TEST_WORKER_INDEX === undefined)
    console.warn(
      `${E2E_TRACE}=1: each failed test's trace and the HTML report hold a live Shopify admin login; do not share them, and delete the run's directory when done`,
    );
  return true;
};

/** Where in the app the project's specs drive the store's admin. */
export interface E2eProjectSpecs {
  readonly name: string;
  readonly testDir: string;
  readonly testMatch: NonNullable<PlaywrightTestProject["testMatch"]>;
}

/**
 * A project of specs on the pack's fixtures, inside the store's admin under the exported login,
 * after {@link SHOPIFY_ADMIN_PROJECT}. The pack registers its own specs with it; an app adds its
 * own the same way, next to {@link e2eProjects}. `root` is the app's directory, which holds the
 * exported login under `playwright/.auth/`. Screenshots and videos are off, and traces unless
 * {@link E2E_TRACE} opts in, because each can carry the login.
 */
export const e2eProject = (
  app: E2eApp,
  root: string,
  { name, testDir, testMatch }: E2eProjectSpecs,
): PlaywrightTestProject<object, E2eOptions> => {
  const adminAuthFile = path.join(root, storageStatePath);
  return {
    name,
    testDir,
    testMatch,
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
      trace: traced() ? "retain-on-failure" : "off",
      screenshot: "off",
      video: "off",
    },
  };
};

/**
 * The pack's projects: {@link SHOPIFY_ADMIN_PROJECT}, then its specs ({@link e2eProject}). Every
 * spec drives the one leased store, so the app's config runs them with `workers: 1`.
 */
export const e2eProjects = (
  app: E2eApp,
  root: string,
): PlaywrightTestProject<object, E2eOptions>[] => [
  {
    name: SHOPIFY_ADMIN_PROJECT,
    testDir: E2E_SPECS_DIR,
    testMatch: /shopify-admin\.setup\.[cm]?[jt]s$/u,
    use: { e2eApp: app, adminAuthFile: path.join(root, storageStatePath) },
  },
  e2eProject(app, root, {
    name: "shopify-app-workers",
    testDir: E2E_SPECS_DIR,
    testMatch: SPEC_MATCH,
  }),
];
