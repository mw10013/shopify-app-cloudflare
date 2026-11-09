import * as Schema from "effect/Schema";
import { PlaywrightTestProject } from "playwright/test";
/** A plan as the app's `PlanCatalog` sells it and as Shopify's plan selection page names its card. */
export declare const E2ePlan: Schema.Struct<{
  readonly handle: Schema.NonEmptyString;
  /** The plan's name in the Partner Dashboard, the heading of its card on the plan selection page. */
  readonly name: Schema.NonEmptyString;
}>;
export type E2ePlan = typeof E2ePlan.Type;
/** The running e2e server: its local port, which the browser and the status reads use, and its tunnel. */
export declare const E2eServer: Schema.Struct<{
  readonly port: Schema.Int;
  readonly tunnel: Schema.NonEmptyString;
}>;
export type E2eServer = typeof E2eServer.Type;
/**
 * What the pack needs of an app: its leased store, its identity and plans, its running e2e server,
 * how to read the server's e2e status route and how to restart the server. Plain data, because
 * Playwright hands project options to the preflight and to every worker.
 */
export declare const E2eApp: Schema.Struct<{
  /** The leased store's handle: `<store>` in `<store>.myshopify.com` and in admin URLs. */
  readonly store: Schema.NonEmptyString;
  /** The app's handle, which names it in admin URLs: `/apps/<handle>`, `/charges/<handle>`. */
  readonly appHandle: Schema.NonEmptyString;
  /** The app's client ID, which its admin install URL names. */
  readonly clientId: Schema.NonEmptyString;
  /**
   * The plans the app sells, cheapest first. The lifecycle spec subscribes to the first and
   * changes to the second when there is one.
   */
  readonly plans: Schema.NonEmptyArray<Schema.Struct<{
    readonly handle: Schema.NonEmptyString;
    /** The plan's name in the Partner Dashboard, the heading of its card on the plan selection page. */
    readonly name: Schema.NonEmptyString;
  }>>;
  readonly server: Schema.Struct<{
    readonly port: Schema.Int;
    readonly tunnel: Schema.NonEmptyString;
  }>;
  /**
   * The e2e status route on the server's local port, answering `GET <path>?shop=<shop>` with an
   * `E2eShopStatus` when sent `headers`.
   */
  readonly status: Schema.Struct<{
    readonly path: Schema.String;
    readonly headers: Schema.$Record<Schema.String, Schema.String>;
  }>;
  /**
   * The webhooks the webhook spec has Shopify deliver to the server's tunnel with `shopify app
   * webhook trigger`: the compliance topics, and `topics`, the app's own topics that are safe to
   * deliver for Shopify's sample shop, `shop.myshopify.com`. `config` is the absolute path of the
   * toml the e2e server serves, the app the Backend checks the HMAC for, whose subscriptions give
   * each topic's path and whose `[webhooks] api_version` the version; the CLI runs in its
   * directory. `record` is the e2e
   * webhook record on the server's local port, answering `GET <record>` with an
   * `E2eWebhookDeliveries` when sent the status route's `headers`.
   */
  readonly webhooks: Schema.Struct<{
    readonly config: Schema.NonEmptyString;
    readonly topics: Schema.$Array<Schema.NonEmptyString>;
    readonly record: Schema.String;
  }>;
  /**
   * Restarts the e2e server on the same store, keeping its data and its status route's headers:
   * `command` run in `cwd`, printing the new {@link E2eServer} as JSON on its last line of stdout.
   * An uninstall ends the Shopify CLI's dev preview on the store (the CLI logs "The dev preview has
   * ended"), and only a new `shopify app dev` installs one again, so the lifecycle spec restarts
   * the server before it reinstalls.
   */
  readonly restart: Schema.Struct<{
    readonly command: Schema.NonEmptyArray<Schema.NonEmptyString>;
    readonly cwd: Schema.NonEmptyString;
  }>;
  /** The store auth scopes the app's suite needs; the preflight checks them when any are given. */
  readonly storeScopes: Schema.$Array<Schema.NonEmptyString>;
}>;
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
export declare const shopOf: (app: E2eApp) => string;
/** The app in the store's admin: every pack spec's `baseURL`. */
export declare const appBaseUrl: (app: E2eApp) => string;
/** The e2e status route's URL for `shop`, on the server's local port. */
export declare const statusUrl: (app: E2eApp, shop: string) => URL;
/**
 * The {@link E2eApp} `status` and `webhooks.record` of an app whose `e2e` Backend serves
 * `withE2eRoutes`: the routes' paths, and the token of the session the running e2e server was
 * started with, read from {@link E2E_SESSION_FILE} under the app's `root`. Throws when the file is
 * absent or is for another store than `store`, the lease's: the server was started before its
 * session, or for another store.
 */
export declare const e2eRoutes: (root: string, store: string) => {
  readonly status: E2eApp["status"];
  readonly record: string;
};
/** The pack's spec and setup files. */
export declare const E2E_SPECS_DIR: string;
/**
 * The run's preflight, for the app's `globalSetup`. Its extension is this module's, so the path
 * holds both in the source (`.ts`) and in the built package, whose JavaScript Playwright loads
 * as is: it does not transpile TypeScript under `node_modules`.
 */
export declare const E2E_PREFLIGHT: string;
/** A spec file, as source or built: `.spec.ts`, `.spec.js`, `.spec.mjs` and the like. */
export declare const SPEC_MATCH: RegExp;
/** The project that exports the agent Chrome's Shopify login; the pack's specs depend on it. */
export declare const SHOPIFY_ADMIN_PROJECT = "shopify-admin";
/**
 * The project of the lifecycle spec, first after the login export: it recovers the store from any
 * state and restarts the e2e server. Every later project runs in a worker of its own, which loads
 * the app's config again and so reads the restarted server.
 */
export declare const LIFECYCLE_PROJECT = "shopify-app-workers-lifecycle";
/** The project of the pack's specs but the lifecycle. */
export declare const SPECS_PROJECT = "shopify-app-workers";
/** The lifecycle spec, as source or built. */
export declare const LIFECYCLE_SPEC_MATCH: RegExp;
/** Set to `1` to keep a trace of each failed test. */
export declare const E2E_TRACE = "E2E_TRACE";
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
export declare const e2eProject: (app: E2eApp, root: string, { name, testDir, testMatch, testIgnore, after }: E2eProjectSpecs) => PlaywrightTestProject<object, E2eOptions>;
/**
 * The pack's projects: {@link SHOPIFY_ADMIN_PROJECT}, the lifecycle ({@link LIFECYCLE_PROJECT}),
 * then its other specs ({@link e2eProject}). Every spec drives the one leased store, so the app's
 * config runs them with `workers: 1`.
 */
export declare const e2eProjects: (app: E2eApp, root: string) => PlaywrightTestProject<object, E2eOptions>[];