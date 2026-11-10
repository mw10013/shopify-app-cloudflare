#!/usr/bin/env node
/**
 * `stores <acquire|show|release|list|pool> ...`, run inside an app with `vp exec stores`.
 *
 * @module
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";

import { command } from "./command.ts";

Command.runWith(command, { version: "1.0.0" })(process.argv.slice(2)).pipe(
  // Effect renders a usage error with help and returns, so the exit code is set here.
  Effect.catchIf(
    (error) => error instanceof CliError.ShowHelp,
    (help) =>
      Effect.sync(() => {
        if (help.errors.length > 0) process.exitCode = 2;
      }),
  ),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
