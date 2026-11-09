/**
 * The Playwright config of a Shopify app's e2e run: rigging's `e2eConfig`, with the app described
 * as an {@link E2eApp} from its e2e lease, its running e2e server and its tomls, and the spec
 * pack registered. An app spreads the config, appends its own projects and overrides any field.
 *
 * @module
 */

import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";

import { app as checkout } from "@mw10013/rigging/core/app";
import { e2eConfig, runningServer } from "@mw10013/rigging/core/test";
import * as Option from "effect/Option";
import type { PlaywrightTestConfig, PlaywrightTestProject } from "playwright/test";

import { appHandle } from "#dev/app-handle.ts";
import { acquireSync } from "#dev/berth.ts";

import {
  E2E_PREFLIGHT,
  type E2eApp,
  type E2eOptions,
  e2eProjects,
  e2eRoutes,
  e2eTrace,
} from "./app.ts";

const RESTART = "vp run e2e:stop && vp run e2e:start";

const clientIdOf = (toml: string) =>
  Option.getOrThrowWith(
    Option.fromNullishOr(
      /^client_id = "(?<id>[0-9a-f]{32})"$/mu.exec(readFileSync(toml, "utf8"))?.groups?.id,
    ),
    () => new Error(`${toml} has no client_id = "<32 hex>" line`),
  );

/** What only the app knows; the rest of its {@link E2eApp} is read from the checkout. */
export interface ShopifyE2eOptions {
  /** The app's directory: `app(import.meta.dirname).root`. */
  readonly root: string;
  readonly plans: E2eApp["plans"];
  /** {@link E2eApp} `webhooks.topics`; none by default. */
  readonly webhookTopics?: E2eApp["webhooks"]["topics"];
  /** {@link E2eApp} `storeScopes`; none by default. */
  readonly storeScopes?: E2eApp["storeScopes"];
  /** {@link E2eApp} `restart.command`, run in `root`; `vpx scripts/e2e.ts reinstall` by default. */
  readonly restart?: E2eApp["restart"]["command"];
}

export interface ShopifyE2e {
  readonly app: E2eApp;
  readonly config: PlaywrightTestConfig<object, E2eOptions> & {
    readonly projects: PlaywrightTestProject<object, E2eOptions>[];
  };
}

/**
 * The app as the pack drives it and the run's config. Synchronous, because Playwright loads its
 * config synchronously; each worker loads it again, so a project after the lifecycle reads the
 * server the lifecycle restarted. It throws, naming the fix, when the lease, the server, its
 * tunnel or the e2e session is missing, or when `shopify.app.e2e.toml` names another app than
 * `shopify.app.toml`, since Shopify would then sign the e2e webhooks with a secret the server
 * does not check.
 *
 * The config is `e2eConfig`'s with the pack's preflight, `workers: 1` and no parallel files,
 * since every spec drives the one leased store, and traces off unless `E2E_TRACE=1`, since a trace
 * under the exported login holds it. The run's directory is readable by this user alone: a
 * failure's error context can name the store's data.
 */
export const shopifyE2eConfig = ({
  root,
  plans,
  webhookTopics = [],
  storeScopes = [],
  restart = ["vpx", "scripts/e2e.ts", "reinstall"],
}: ShopifyE2eOptions): ShopifyE2e => {
  const store = acquireSync("e2e", checkout(root)).store;
  const server = runningServer("e2e", root);
  if (server.url === null || server.url === "")
    throw new Error(`the e2e server published no tunnel (no APP_URL): ${RESTART}`);
  const routes = e2eRoutes(root, store);
  const appToml = path.join(root, "shopify.app.toml");
  const e2eToml = path.join(root, "shopify.app.e2e.toml");
  const clientId = clientIdOf(appToml);
  if (clientIdOf(e2eToml) !== clientId)
    throw new Error(
      `${e2eToml} names another app than ${appToml}, so Shopify would sign the e2e webhooks with another secret than the server checks: ${RESTART}`,
    );
  const app: E2eApp = {
    store,
    appHandle: appHandle(appToml),
    clientId,
    plans,
    server: { port: server.port, tunnel: server.url },
    status: routes.status,
    webhooks: { config: e2eToml, topics: webhookTopics, record: routes.record },
    restart: { command: restart, cwd: root },
    storeScopes,
  };
  const base = e2eConfig({ root });
  chmodSync(path.dirname(base.outputDir), 0o700);
  return {
    app,
    config: {
      ...base,
      globalSetup: E2E_PREFLIGHT,
      fullyParallel: false,
      workers: 1,
      retries: 0,
      use: { ...base.use, trace: e2eTrace() },
      projects: e2eProjects(app, root),
    },
  };
};
