/**
 * The long-lived e2e server's command line, for an app's `scripts/e2e.ts`
 * ({@link e2eServerCommand}): `start`, `status`, `restart` and `reinstall` of the checkout's
 * `shopify app dev` on its e2e lease's pool store, under rigging server, which every e2e run reuses. A
 * start writes the e2e session the stack binds and the spec pack reads, waits for the stack and
 * the Shopify CLI's first `app/uninstalled`, and grants the store auth the suite needs.
 *
 * @module
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { app } from "@mw10013/rigging/core/app";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import {
  describeRunning,
  loadClientId,
  loadServer,
  type RunningServer,
  runningServer,
  type Server,
  ServerError,
  startServer,
  statusReport,
  step,
  stopServer,
} from "#dev/server.ts";
import { destroyStage, recordStore, resetStaleStage } from "#dev/stage-store.ts";
import { StoreFor } from "#dev/worktree.ts";
import { E2E_SESSION_FILE, E2eSession, E2eSessionJson } from "#test/e2e-session.ts";

import { authorizeStore } from "./store-auth.ts";

const loadE2e = loadServer("e2e");

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
 * How a start treats the session: `fresh` writes a new one, which the stack binds as it comes up;
 * `kept` requires the one already written, for the server's shop: an adopted server was started
 * with it, and a reinstall keeps it so the suite's status reads go on working.
 */
type SessionMode = "fresh" | "kept";

const prepareSession = (server: Server, mode: SessionMode) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const shop = `${server.store}.myshopify.com`;
    if (mode === "kept") {
      const session = yield* fs
        .readFileString(sessionPath())
        .pipe(Effect.flatMap(Schema.decodeEffect(E2eSessionJson)), Effect.option);
      if (Option.exists(session, (value) => value.shop === shop)) return;
      return yield* new ServerError({
        message: `the e2e server has no session for ${shop} in ${E2E_SESSION_FILE}; vp run e2e:stop then vp run e2e:start`,
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

/** Alchemy's last line once it has deployed the stage's Workers, so the app answers. */
const STACK_DEPLOYED = /INFO: Done: \d+ succeeded/u;

/** The Shopify CLI announcing the `app/uninstalled` it sends the app as it starts. */
const RESET_WEBHOOK_SENT = /Sending APP_UNINSTALLED webhook to app server/u;

/** The CLI's last word on that webhook. */
const RESET_WEBHOOK_SETTLED =
  /APP_UNINSTALLED webhook delivered|APP_UNINSTALLED webhook delivery failed|App hasn't started in time, giving up/u;

/** rigging server stamps each line of the log, and opens each run with this. */
const RUN_MARKER = "==== e2e start ";

/** Alchemy takes about 20 s; the CLI tries the webhook three times, five seconds apart. */
const SERVER_READY_TIMEOUT = Duration.minutes(3);

/**
 * How long a start that expects no `app/uninstalled` still watches for one after the stack has
 * deployed. The CLI announces it seconds after starting, long before Alchemy is done, so one that
 * has not shown by then is not coming.
 */
const RESET_WEBHOOK_GRACE = Duration.seconds(5);

/**
 * Whether this start's `shopify app dev` sends the app an `app/uninstalled`: it does when the
 * checkout's project cache, `.shopify/project.json`, has no entry for the app's client ID, which a
 * checkout's first start writes.
 */
const expectsResetWebhook = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const clientId = yield* loadClientId;
  const cached = yield* fs.readFileString(path.join(app().root, ".shopify", "project.json")).pipe(
    Effect.flatMap(
      Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))),
    ),
    Effect.map((project) => Object.hasOwn(project, clientId)),
    Effect.orElseSucceed(() => false),
  );
  return !cached;
});

/** What the server's log says of its current run, from that run's {@link RUN_MARKER} on. */
const readRun = (log: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(log).pipe(Effect.orElseSucceed(() => ""));
    const start = text.lastIndexOf(RUN_MARKER);
    if (start === -1)
      return yield* new ServerError({
        message: `${log} has no "${RUN_MARKER.trim()}" line for the run just started: read vp run e2e:logs`,
      });
    const run = text.slice(start);
    return {
      deployed: STACK_DEPLOYED.test(run),
      sent: RESET_WEBHOOK_SENT.test(run),
      settled: RESET_WEBHOOK_SETTLED.test(run),
    };
  });

/**
 * Waits, from the server's log of the run just started, until Alchemy has deployed the stack and
 * the Shopify CLI has settled the `app/uninstalled` it sends on a checkout's first start
 * ({@link expectsResetWebhook}). The app deletes the shop's `AppInstallation` row on it, so a row
 * the suite's first load wrote before it arrived would vanish. A start that expects none waits
 * {@link RESET_WEBHOOK_GRACE} after the deploy, and settles one that shows within it.
 */
const awaitServerReady = (running: RunningServer, resetExpected: boolean) =>
  Effect.gen(function* () {
    const log = path.resolve(app().root, running.log);
    const deployedAt = yield* Ref.make(Option.none<DateTime.Utc>());
    const ready = Effect.gen(function* () {
      const run = yield* readRun(log);
      if (!run.deployed) return false;
      if (run.sent) return run.settled;
      if (resetExpected) return false;
      const now = yield* DateTime.now;
      const since = yield* Ref.updateAndGet(
        deployedAt,
        Option.orElse(() => Option.some(now)),
      );
      return Option.exists(
        since,
        (at) => !DateTime.isLessThan(now, DateTime.addDuration(at, RESET_WEBHOOK_GRACE)),
      );
    });
    yield* ready.pipe(
      Effect.repeat({ until: (done) => done, schedule: Schedule.spaced(Duration.seconds(1)) }),
      Effect.timeoutOrElse({
        duration: SERVER_READY_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new ServerError({
              message: `the e2e server was not ready within ${Duration.format(SERVER_READY_TIMEOUT)}${resetExpected ? " (a first start waits for the Shopify CLI's app/uninstalled)" : ""}: read vp run e2e:logs`,
            }),
          ),
      }),
    );
  });

/** What {@link e2eServerCommand} needs of an app. */
export interface E2eServerOptions<R = never> {
  /**
   * The files, relative to the app's root, whose change since the server started needs a refresh;
   * a directory stands for every file in it. `status` names the changed ones.
   */
  readonly restartFiles: readonly string[];
  /** The store auth scopes the app's suite needs (its `E2eApp` `storeScopes`); none skips it. */
  readonly storeScopes: readonly string[];
  /**
   * The app's own preparation of the store, on every start once store auth is granted. The store
   * is already recorded when it runs, so it cannot use the record to tell a new store from one it
   * prepared; it checks the store itself.
   */
  readonly prepareStore?: (
    server: Server,
    running: RunningServer,
  ) => Effect.Effect<void, ServerError, R>;
}

/** The {@link E2eServerOptions} `restartFiles` changed since `since`, a directory by any file in it. */
const changedSince = (restartFiles: readonly string[], since: Date) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { root } = app();
    const newer = (file: string) =>
      fs.stat(path.join(root, file)).pipe(
        Effect.map((info) => Option.exists(info.mtime, (mtime) => mtime > since)),
        Effect.orElseSucceed(() => false),
      );
    const files = yield* Effect.forEach(restartFiles, (file) =>
      fs.readDirectory(path.join(root, file)).pipe(
        Effect.map((names) => names.map((name) => path.join(file, name))),
        Effect.orElseSucceed(() => [file]),
      ),
    );
    return yield* Effect.filter(files.flat(), newer);
  });

/**
 * The `e2e` command an app's `scripts/e2e.ts` runs, behind `vp run e2e:start | e2e:status |
 * e2e:restart`; the spec pack's lifecycle runs `reinstall` as its `E2eApp` `restart`. The app runs
 * it with `Command.run` under `NodeServices.layer`.
 *
 * @example
 * ```ts
 * e2eServerCommand({ restartFiles: ["package.json", "migrations"], storeScopes: ["read_products"] }).pipe(
 *   Command.run({ version: "1.0.0" }),
 *   Effect.provide(NodeServices.layer),
 *   NodeRuntime.runMain,
 * );
 * ```
 */
export const e2eServerCommand = <R = never>({
  restartFiles,
  storeScopes,
  prepareStore,
}: E2eServerOptions<R>) => {
  /**
   * Store auth on every start, then the app's own preparation: {@link authorizeStore} does
   * nothing when the store already has every scope.
   */
  const prepare = (server: Server, running: RunningServer) =>
    Effect.gen(function* () {
      if (storeScopes.length > 0)
        yield* authorizeStore(server.store, storeScopes).pipe(
          Effect.mapError((error) => new ServerError({ message: error.message })),
        );
      if (prepareStore !== undefined) yield* prepareStore(server, running);
    });

  /**
   * The store is recorded as soon as the server runs on it, so a later start knows which store
   * the stage holds even when store auth fails. A server this invocation started is stopped when
   * it is not ready in time, store preparation fails, or the invocation is interrupted (a killed
   * restart): a later start adopts a running server without waiting for it, so none is left
   * unconfirmed. An adopted one keeps running.
   */
  const start = (mode: SessionMode) =>
    Effect.gen(function* () {
      const server = yield* loadE2e;
      yield* requirePoolStore(server);
      yield* resetStaleStage(server);
      const adopted = Option.isSome(yield* Effect.option(runningServer("e2e")));
      yield* prepareSession(server, adopted ? "kept" : mode);
      const resetExpected = yield* expectsResetWebhook;
      return yield* Effect.gen(function* () {
        const running = yield* startServer(server);
        yield* recordStore(server);
        yield* Console.log(`\n${yield* describeRunning(server, running)}`);
        if (!adopted) yield* step("app dev ready", awaitServerReady(running, resetExpected));
        yield* prepare(server, running);
        return running;
      }).pipe(
        Effect.onError(() =>
          adopted ? Effect.void : step("stop", stopServer("e2e")).pipe(Effect.ignore),
        ),
      );
    });

  const startCommand = Command.make("start", {}, () =>
    start("fresh").pipe(Effect.mapError(toUserError)),
  ).pipe(
    Command.withDescription(
      `Start the e2e server, or adopt the one already running, on the e2e lease's pool store. It keeps its data unless its stage was set up for another store: that stage is destroyed first. A started server gets a fresh e2e session in ${E2E_SESSION_FILE}, and is waited for until its stack is deployed and the Shopify CLI has settled the app/uninstalled it sends on a checkout's first start (a later start watches a few seconds for one). It then grants the store's store auth and prepares the store, and stops a server it started when any of these fails or the start is interrupted.`,
    ),
  );

  const restartCommand = Command.make("restart", {}, () =>
    Effect.gen(function* () {
      const server = yield* loadE2e;
      yield* step("stop", stopServer("e2e"));
      yield* step(`destroy stage ${server.stage}`, destroyStage(server));
      yield* start("fresh");
    }).pipe(Effect.mapError(toUserError)),
  ).pipe(
    Command.withDescription(
      "Stop the e2e server, destroy its stage's local data, and start it: the clean slate for schema changes. For dependency or stack changes, use e2e:stop then e2e:start to preserve data.",
    ),
  );

  /**
   * The spec pack's restart (its `E2eApp` `restart`): an uninstall ends the Shopify CLI's dev
   * preview on the store, and only a new `shopify app dev` installs one again. Keeps the stage's
   * data and the session, and prints the new server as JSON on its last line.
   */
  const reinstallCommand = Command.make("reinstall", {}, () =>
    Effect.gen(function* () {
      yield* step("stop", stopServer("e2e"));
      const running = yield* start("kept");
      const tunnel = yield* Effect.fromOption(running.url).pipe(
        Effect.mapError(() => new ServerError({ message: "the e2e server published no tunnel" })),
      );
      yield* Console.log(JSON.stringify({ port: running.port, tunnel }));
    }).pipe(Effect.mapError(toUserError)),
  ).pipe(
    Command.withDescription(
      "Stop and start the e2e server, keeping its data and its e2e session, so shopify app dev installs its dev preview on the store again, as an uninstall ends it. Prints the new server's port and tunnel as JSON on the last line, for the e2e spec pack.",
    ),
  );

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
        const stale = Option.isSome(started)
          ? yield* changedSince(restartFiles, started.value)
          : [];
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

  return Command.make("e2e").pipe(
    Command.withDescription(
      [
        "Run this checkout's long-lived e2e server (shopify app dev on the e2e store, under rigging server) for every e2e run.",
        "start adopts a server already running for this checkout, or starts one detached, like the dev server; it writes shopify.app.e2e.toml from shopify.app.toml first.",
        "Output goes to .rigging/servers/e2e/log/current; vp run e2e:logs -f follows it.",
      ].join("\n"),
    ),
    Command.withSubcommands([startCommand, statusCommand, restartCommand, reinstallCommand]),
  );
};
