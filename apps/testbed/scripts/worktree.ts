#!/usr/bin/env vpx
/** `vp run worktree:init`: prepares a linked worktree to serve its own dev server. */

import path from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import * as Berth from "#devkit/shopify/berth.ts";
import { checkoutKind, currentBranch, WorktreeError } from "#devkit/shopify/worktree.ts";

const init = Effect.gen(function* () {
  const { root, linked } = yield* checkoutKind;
  if (!linked)
    return yield* new WorktreeError({
      message: "this is the main checkout: run worktree:init in a linked worktree",
    });
  const branch = yield* currentBranch;

  const dev = yield* Berth.acquire("dev");
  const e2e = yield* Berth.acquire("e2e");
  yield* Console.log(`ok    berth leases: dev on ${dev.store}, e2e on ${e2e.store}`);

  yield* Console.log(`\n${branch === "" ? path.basename(root) : branch} ready. Next: vp run dev`);
});

const toUserError = (error: { readonly message: string }) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

const initCommand = Command.make("init", {}, () => init.pipe(Effect.mapError(toUserError))).pipe(
  Command.withDescription(
    "Prepare this linked worktree: its dev and e2e leases from berth. wt shares .env, refs and .env.<stage> before running it.",
  ),
);

Command.make("worktree").pipe(
  Command.withDescription("Set up long-lived linked worktrees of this repository"),
  Command.withSubcommands([initCommand]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
