#!/usr/bin/env vpx
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PerDeveloper } from "@mw10013/rigging/cloudflare/stage";
import { stage } from "@mw10013/shopify-app-workers/dev/worktree";
import * as Argument from "effect/cli/Argument";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

Command.make(
  "stage",
  {
    environment: Argument.Literals("environment", PerDeveloper.literals).pipe(
      Argument.withDescription("A per-developer environment: dev, test or e2e"),
    ),
  },
  ({ environment }) =>
    stage(environment).pipe(
      Effect.flatMap(Console.log),
      Effect.mapError(
        (error) => new CliError.UserError({ cause: error, userMessage: error.message }),
      ),
    ),
).pipe(
  Command.withDescription("Print this checkout's stage of an environment."),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
