#!/usr/bin/env vpx
/** `vp run dev | dev:status`: this checkout's dev server. */

import process from "node:process";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  describeRunning,
  loadServer,
  startServer,
  statusReport,
} from "@mw10013/shopify-app-workers/dev/server";
import { recordStore, resetStaleStage } from "@mw10013/shopify-app-workers/dev/stage-store";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const loadDev = loadServer("dev");

const toUserError = (error: { readonly message: string }) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

/** The testbed needs no store setup yet, so a started server's store is recorded at once. */
const start = Effect.gen(function* () {
  const server = yield* loadDev;
  yield* resetStaleStage(server);
  const running = yield* startServer(server);
  yield* Console.log(`\n${yield* describeRunning(server, running)}`);
  yield* recordStore(server);
});

const startCommand = Command.make("start", {}, () => start.pipe(Effect.mapError(toUserError))).pipe(
  Command.withDescription(
    "Start the dev server, or adopt the one already running. On a store new to this checkout's dev stage, it destroys a stage set up for another store first.",
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
      const report = yield* statusReport(yield* loadDev);
      const healthy = Option.isSome(report.running);
      yield* Console.log(
        json
          ? JSON.stringify({ healthy, ...report.json }, null, 2)
          : `healthy: ${healthy ? "yes" : "no"}\n${report.text}`,
      );
      if (!healthy) yield* Effect.sync(() => (process.exitCode = 1));
    }).pipe(Effect.mapError(toUserError)),
).pipe(
  Command.withDescription(
    "Report whether the dev server runs and answers, and its tunnel. Read-only; exit code 1 when unhealthy.",
  ),
);

Command.make("dev").pipe(
  Command.withDescription(
    [
      "Run this checkout's dev server (shopify app dev, which runs alchemy dev, under rigging server), the same for an agent and a person.",
      "start adopts a server already running for this checkout, or starts one detached, waits until it answers, and exits; the server keeps running until dev:stop.",
      "vp run dev:logs -f follows its log.",
    ].join("\n"),
  ),
  Command.withSubcommands([startCommand, statusCommand]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
