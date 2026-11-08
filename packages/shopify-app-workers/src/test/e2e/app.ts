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

/** A plan as the app's `PlanCatalog` sells it and as Shopify's plan selection page names its card. */
export const E2ePlan = Schema.Struct({
  handle: Schema.NonEmptyString,
  /** The plan's name in the Partner Dashboard, the heading of its card on the plan selection page. */
  name: Schema.NonEmptyString,
});
export type E2ePlan = typeof E2ePlan.Type;

/** The running e2e server: its local port, which the browser and the status reads use, and its tunnel. */
export const E2eServer = Schema.Struct({ port: Schema.Int, tunnel: Schema.NonEmptyString });
export type E2eServer = typeof E2eServer.Type;

/**
 * What the pack needs of an app: its leased store, its identity and plans, its running e2e server,
 * how to read the server's e2e status route and how to restart the server. Plain data, because
 * Playwright hands project options to the preflight and to every worker.
 */
export const E2eApp = Schema.Struct({
  /** The leased store's handle: `<store>` in `<store>.myshopify.com` and in admin URLs. */
  store: Schema.NonEmptyString,
  /** The app's handle, which names it in admin URLs: `/apps/<handle>`, `/charges/<handle>`. */
  appHandle: Schema.NonEmptyString,
  /** The app's client ID, which its admin install URL names. */
  clientId: Schema.NonEmptyString,
  /**
   * The plans the app sells, cheapest first. The lifecycle spec subscribes to the first and
   * changes to the second when there is one.
   */
  plans: Schema.NonEmptyArray(E2ePlan),
  server: E2eServer,
  /**
   * The e2e status route on the server's local port, answering `GET <path>?shop=<shop>` with an
   * `E2eShopStatus` when sent `headers`.
   */
  status: Schema.Struct({
    path: Schema.String.check(Schema.isStartingWith("/")),
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  /**
   * The webhooks the webhook spec has Shopify deliver to the server's tunnel with `shopify app
   * webhook trigger`: the compliance topics, and `topics`, the app's own topics that are safe to
   * deliver for Shopify's sample shop, `shop.myshopify.com`. `config` is the absolute path of the
   * app's linked `shopify.app.toml`, whose subscriptions give each topic's path and whose
   * `[webhooks] api_version` the version; the CLI runs in its directory. `record` is the e2e
   * webhook record on the server's local port, answering `GET <record>` with an
   * `E2eWebhookDeliveries` when sent the status route's `headers`.
   */
  webhooks: Schema.Struct({
    config: Schema.NonEmptyString,
    topics: Schema.Array(Schema.NonEmptyString),
    record: Schema.String.check(Schema.isStartingWith("/")),
  }),
  /**
   * Restarts the e2e server on the same store, keeping its data and its status route's headers:
   * `command` run in `cwd`, printing the new {@link E2eServer} as JSON on its last line of stdout.
   * An uninstall ends the Shopify CLI's dev preview on the store (the CLI logs "The dev preview has
   * ended"), and only a new `shopify app dev` installs one again, so the lifecycle spec restarts
   * the server before it reinstalls.
   */
  restart: Schema.Struct({
    command: Schema.NonEmptyArray(Schema.NonEmptyString),
    cwd: Schema.NonEmptyString,
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

/** The app in the store's admin: every pack spec's `baseURL`. */
export const appBaseUrl = (app: E2eApp) =>
  `https://admin.shopify.com/store/${app.store}/apps/${app.appHandle}`;

/** The e2e status route's URL for `shop`, on the server's local port. */
export const statusUrl = (app: E2eApp, shop: string) => {
  const url = new URL(app.status.path, `http://localhost:${String(app.server.port)}`);
  url.searchParams.set("shop", shop);
  return url;
};

/** The e2e webhook record's URL, on the server's local port. */
export const webhookRecordUrl = (app: E2eApp) =>
  new URL(app.webhooks.record, `http://localhost:${String(app.server.port)}`);

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

/**
 * The project of the lifecycle spec, first after the login export: it recovers the store from any
 * state and restarts the e2e server. Every later project runs in a worker of its own, which loads
 * the app's config again and so reads the restarted server.
 */
export const LIFECYCLE_PROJECT = "shopify-app-workers-lifecycle";

/** The project of the pack's specs but the lifecycle. */
export const SPECS_PROJECT = "shopify-app-workers";

/** The lifecycle spec, as source or built. */
export const LIFECYCLE_SPEC_MATCH = /lifecycle\.spec\.[cm]?[jt]s$/u;

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
  readonly testIgnore?: PlaywrightTestProject["testIgnore"];
  /**
   * Projects that run first, besides {@link SHOPIFY_ADMIN_PROJECT}: by default
   * {@link LIFECYCLE_PROJECT}, which leaves the store installed on a plan.
   */
  readonly after?: readonly string[];
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
  { name, testDir, testMatch, testIgnore = [], after = [LIFECYCLE_PROJECT] }: E2eProjectSpecs,
): PlaywrightTestProject<object, E2eOptions> => {
  const adminAuthFile = path.join(root, storageStatePath);
  return {
    name,
    testDir,
    testMatch,
    testIgnore,
    dependencies: [SHOPIFY_ADMIN_PROJECT, ...after],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
      e2eApp: app,
      adminAuthFile,
      baseURL: appBaseUrl(app),
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
 * The pack's projects: {@link SHOPIFY_ADMIN_PROJECT}, the lifecycle ({@link LIFECYCLE_PROJECT}),
 * then its other specs ({@link e2eProject}). Every spec drives the one leased store, so the app's
 * config runs them with `workers: 1`.
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
    name: LIFECYCLE_PROJECT,
    testDir: E2E_SPECS_DIR,
    testMatch: LIFECYCLE_SPEC_MATCH,
    after: [],
  }),
  e2eProject(app, root, {
    name: SPECS_PROJECT,
    testDir: E2E_SPECS_DIR,
    testMatch: SPEC_MATCH,
    testIgnore: LIFECYCLE_SPEC_MATCH,
  }),
];
