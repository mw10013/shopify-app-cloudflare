#!/usr/bin/env vpx
/**
 * `vp run e2e:start | e2e:status | e2e:restart`: this checkout's long-lived e2e server, which every
 * e2e run reuses. A schema change needs `restart`, which deletes the stage's local data.
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { app } from "@mw10013/devkit/core/app";
import {
  describeRunning,
  loadServer,
  runningServer,
  type Server,
  ServerError,
  startServer,
  statusReport,
  step,
  stopServer,
} from "@mw10013/devkit/shopify/server";
import { destroyStage, recordStore, resetStaleStage } from "@mw10013/devkit/shopify/stage-store";
import { StoreFor } from "@mw10013/devkit/shopify/worktree";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { E2E_SESSION_FILE, E2eSession, E2eSessionJson } from "#e2e/session.ts";

import { authorizeStore } from "./lib/store-auth.ts";

const loadE2e = loadServer("e2e");

/**
 * Files that need a server refresh. D1 is migrated only when the stage's database is created, so
 * a schema change needs `restart`.
 */
const RESTART_FILES = [
  "package.json",
  "../../pnpm-lock.yaml",
  "alchemy.run.ts",
  "migrations",
  "../../packages/shopify-app-workers/package.json",
];

const toUserError = (error: { readonly message: string }) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

/**
 * The e2e server installs the dev app on its store, so the lease must be a pool store, checked
 * before anything touches the stage or the store.
 */
const requirePoolStore = (server: Server) =>
  Schema.decodeUnknownEffect(StoreFor(["pool"], "a pool store"))(server.store).pipe(
    Effect.mapError(
      () =>
        new ServerError({
          message: `the e2e lease is ${server.store}, not a pool store (mw10013-pool-NN)`,
        }),
    ),
  );

const sessionPath = () => path.join(app().root, E2E_SESSION_FILE);

/**
 * A fresh session for a server this invocation starts, which its stack binds as it comes up. An
 * adopted server keeps the session it was started with, so the file must be there, for its shop.
 */
const prepareSession = (server: Server, adopted: boolean) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const shop = `${server.store}.myshopify.com`;
    if (adopted) {
      const session = yield* fs
        .readFileString(sessionPath())
        .pipe(Effect.flatMap(Schema.decodeEffect(E2eSessionJson)), Effect.option);
      if (Option.exists(session, (value) => value.shop === shop)) return;
      return yield* new ServerError({
        message: `the running e2e server has no session for ${shop} in ${E2E_SESSION_FILE}; vp run e2e:stop then vp run e2e:start`,
      });
    }
    const session = yield* Schema.decodeUnknownEffect(E2eSession)({
      token: randomBytes(32).toString("hex"),
      shop,
    });
    const text = yield* Schema.encodeEffect(E2eSessionJson)(session);
    yield* fs.makeDirectory(path.dirname(sessionPath()), { recursive: true });
    yield* fs.writeFileString(sessionPath(), text, { mode: 0o600 });
  }).pipe(Effect.mapError((error) => new ServerError({ message: error.message })));

/**
 * Store auth only: the e2e suite selects the plan itself, so the store gets no plan here. It runs
 * on every start; {@link authorizeStore} does nothing when the store already has every scope.
 */
const prepareStore = (server: Server) =>
  authorizeStore(server.store).pipe(
    Effect.mapError((error) => new ServerError({ message: error.message })),
  );

/**
 * The store is recorded as soon as the server runs on it, so a later start knows which store the
 * stage holds even when store auth fails. A server this invocation started is stopped when store
 * auth fails; an adopted one keeps running.
 */
const start = Effect.gen(function* () {
  const server = yield* loadE2e;
  yield* requirePoolStore(server);
  yield* resetStaleStage(server);
  const adopted = Option.isSome(yield* Effect.option(runningServer("e2e")));
  yield* prepareSession(server, adopted);
  const running = yield* startServer(server);
  yield* recordStore(server);
  yield* Console.log(`\n${yield* describeRunning(server, running)}`);
  yield* prepareStore(server).pipe(
    Effect.tapError(() => (adopted ? Effect.void : step("stop", stopServer("e2e")))),
  );
});

const startCommand = Command.make("start", {}, () => start.pipe(Effect.mapError(toUserError))).pipe(
  Command.withDescription(
    "Start the e2e server, or adopt the one already running, on the e2e lease's pool store. It keeps its data unless its stage was set up for another store: that stage is destroyed first. A started server gets a fresh status route token in .state/e2e.session.json. It then checks the store's store auth, and stops a server it started when that fails.",
  ),
);

const restartCommand = Command.make("restart", {}, () =>
  Effect.gen(function* () {
    const server = yield* loadE2e;
    yield* step("stop", stopServer("e2e"));
    yield* step(`destroy stage ${server.stage}`, destroyStage(server));
    yield* start;
  }).pipe(Effect.mapError(toUserError)),
).pipe(
  Command.withDescription(
    "Stop the e2e server, destroy its stage's local data, and start it: the clean slate for schema changes. For dependency or stack changes, use e2e:stop then e2e:start to preserve data.",
  ),
);

/** The {@link RESTART_FILES} changed since `since`, a directory by any file in it. */
const changedSince = (since: Date) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { root } = app();
    const newer = (file: string) =>
      fs.stat(path.join(root, file)).pipe(
        Effect.map((info) => Option.exists(info.mtime, (mtime) => mtime > since)),
        Effect.orElseSucceed(() => false),
      );
    const files = yield* Effect.forEach(RESTART_FILES, (file) =>
      fs.readDirectory(path.join(root, file)).pipe(
        Effect.map((names) => names.map((name) => path.join(file, name))),
        Effect.orElseSucceed(() => [file]),
      ),
    );
    return yield* Effect.filter(files.flat(), newer);
  });

const statusCommand = Command.make(
  "status",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the report as JSON"),
      Flag.withDefault(false),
    ),
  },
  ({ json }) =>
    Effect.gen(function* () {
      const report = yield* statusReport(yield* loadE2e);
      const healthy = Option.isSome(report.running) && report.tunnelState === "ready";
      const started = Option.flatMap(report.running, (running) => running.startedAt);
      const stale = Option.isSome(started) ? yield* changedSince(started.value) : [];
      yield* Console.log(
        json
          ? JSON.stringify({ healthy, ...report.json, changedSinceStart: stale }, null, 2)
          : [
              `healthy: ${healthy ? "yes" : "no"}`,
              report.text,
              ...(stale.length > 0
                ? [
                    `changed since start: ${stale.join(", ")}; refresh: vp run e2e:stop then vp run e2e:start; schema reset: vp run e2e:restart (deletes local data)`,
                  ]
                : []),
            ].join("\n"),
      );
      if (!healthy) yield* Effect.sync(() => (process.exitCode = 1));
    }).pipe(Effect.mapError(toUserError)),
).pipe(
  Command.withDescription(
    "Report whether the e2e server runs, answers, and its tunnel serves. Read-only; exit code 1 when unhealthy.",
  ),
);

Command.make("e2e").pipe(
  Command.withDescription(
    [
      "Run this checkout's long-lived e2e server (shopify app dev on the e2e store, under bosun) for every e2e run.",
      "start adopts a server already running for this checkout, or starts one detached, like the dev server; it writes shopify.app.e2e.toml from shopify.app.toml first.",
      "Output goes to .bosun/e2e/log/current; vp run e2e:logs -f follows it.",
    ].join("\n"),
  ),
  Command.withSubcommands([startCommand, statusCommand, restartCommand]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
