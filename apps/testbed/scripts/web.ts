#!/usr/bin/env vpx
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { webEnvironment } from "@mw10013/devkit/shopify/web";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

Command.make("web", {}, () =>
  webEnvironment.pipe(
    Effect.flatMap(Console.log),
    Effect.mapError(
      (error) => new CliError.UserError({ cause: error, userMessage: error.message }),
    ),
  ),
).pipe(
  Command.withDescription("Print the environment the Shopify CLI's web command serves."),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
