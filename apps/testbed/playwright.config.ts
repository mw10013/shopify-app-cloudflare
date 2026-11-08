import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { app } from "@mw10013/devkit/core/app";
import { testRunDirectory } from "@mw10013/devkit/core/test-runs";
import { appHandle } from "@mw10013/devkit/shopify/app-handle";
import { acquireSync } from "@mw10013/devkit/shopify/berth";
import { runningServerSync } from "@mw10013/devkit/shopify/server";
import {
  E2E_PREFLIGHT,
  type E2eApp,
  type E2eOptions,
  e2eProjects,
} from "@mw10013/shopify-app-workers/test/e2e";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { defineConfig } from "playwright/test";

import { catalog } from "#backend/app.ts";
import { E2E_SESSION_FILE, E2E_TOKEN_HEADER, E2eSessionJson } from "#e2e/session.ts";
import { E2E_STATUS_PATH } from "#e2e/status.ts";
import { E2E_WEBHOOKS_PATH } from "#e2e/webhooks.ts";
import { STORE_SCOPES } from "#scripts/lib/store-auth.ts";

const devkitApp = app(import.meta.dirname);
const { root } = devkitApp;
const RESTART = "vp run e2e:stop && vp run e2e:start";

/** This checkout's e2e store, from its berth lease. */
const store = acquireSync("e2e", devkitApp).store;
/** The running e2e server, from bosun; loading the config fails when it is not running. */
const server = runningServerSync("e2e", devkitApp);
const tunnel = Option.getOrThrowWith(
  server.url,
  () => new Error(`the e2e server published no tunnel (no APP_URL): ${RESTART}`),
);
/** The running server's session: the status route's token, for the lease's shop. */
const session = Schema.decodeUnknownSync(E2eSessionJson)(
  readFileSync(path.join(root, E2E_SESSION_FILE), "utf8"),
);
if (session.shop !== `${store}.myshopify.com`)
  throw new Error(`${E2E_SESSION_FILE} is for ${session.shop}, not ${store}: ${RESTART}`);

const appToml = path.join(root, "shopify.app.toml");
const clientId = Option.getOrThrowWith(
  Option.fromNullishOr(
    /^client_id = "(?<id>[0-9a-f]{32})"$/mu.exec(readFileSync(appToml, "utf8"))?.groups?.id,
  ),
  () => new Error(`${appToml} has no client_id = "<32 hex>" line`),
);

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

const testbed: E2eApp = {
  store,
  appHandle: appHandle(appToml),
  clientId,
  plans: PLANS,
  server: { port: server.port, tunnel },
  status: { path: E2E_STATUS_PATH, headers: { [E2E_TOKEN_HEADER]: session.token } },
  // shop/update only logs, so Shopify's sample of it is safe to deliver.
  webhooks: { config: appToml, topics: ["shop/update"], record: E2E_WEBHOOKS_PATH },
  restart: { command: ["vpx", "scripts/e2e.ts", "reinstall"], cwd: root },
  storeScopes: STORE_SCOPES,
};

/**
 * This run's results, kept until 30 newer runs exist: `results.json`, `report/`
 * (`vp exec playwright show-report <dir>/report`) and `results/` (each failed test's trace).
 */
const run = testRunDirectory("e2e", ["results/.last-run.json"], root);
// Only this user reads a run's results and report: a failure's error context can name the store's
// data, and an opted-in trace (`E2E_TRACE=1`) holds the Shopify admin login.
chmodSync(run, 0o700);
if (process.env.TEST_WORKER_INDEX === undefined) console.log(`e2e results: ${run}`);

/**
 * Runs the package's end-to-end spec pack against this checkout's long-lived e2e server
 * (`vp run e2e:start`, `scripts/e2e.ts`) in the agent Chrome. Playwright does not start the
 * server: the config fails to load when it is not running, and the pack's preflight fails the
 * run in one line when the server, its tunnel, the store's store auth or the agent Chrome is not
 * ready.
 */
export default defineConfig<object, E2eOptions>({
  globalSetup: E2E_PREFLIGHT,
  outputDir: `${run}/results`,
  fullyParallel: false,
  // Every spec drives the one leased store.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["json", { outputFile: `${run}/results.json` }],
    ["html", { outputFolder: `${run}/report`, open: "never" }],
  ],
  projects: e2eProjects(testbed, root),
});
