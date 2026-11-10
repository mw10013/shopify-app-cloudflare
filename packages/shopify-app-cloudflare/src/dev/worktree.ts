import path from "node:path";

import { type PerDeveloper, PerDeveloperStage } from "@mw10013/rigging/cloudflare/stage";
import { runCommand } from "@mw10013/rigging/core/command";
/**
 * A checkout of this repository is either the main checkout, whose `.git` is
 * the repository, or a linked worktree on any branch, which `wt new` creates
 * under `~/.t3/worktrees/<project>/<name>`. Each checkout has its
 * own `.env`, `.alchemy/`, `.rigging/servers/`, `.state/` and `.test-results/`, and its own store
 * leases ({@link "./stores.ts"}), so each runs its own dev server, on a port it picks, and
 * its own `shopify app dev` session on its own dev store.
 *
 * @module
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

export class WorktreeError extends Schema.TaggedError<WorktreeError>()("WorktreeError", {
  message: Schema.String,
}) {}

const Lines = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Array(Schema.String),
    SchemaTransformation.transform({
      decode: (output): readonly string[] => output.trim().split("\n"),
      encode: (lines) => lines.join("\n"),
    }),
  ),
);

const gitDirs = runCommand("git", [
  "rev-parse",
  "--path-format=absolute",
  "--git-dir",
  "--git-common-dir",
]).pipe(
  Effect.flatMap(
    Schema.decodeUnknownEffect(
      Lines.pipe(Schema.decodeTo(Schema.Tuple([Schema.String, Schema.String]))),
    ),
  ),
  Effect.map(([gitDir, commonDir]) => ({ gitDir, commonDir })),
);

export const checkoutKind = Effect.all([
  gitDirs,
  runCommand("git", ["rev-parse", "--show-toplevel"]),
]).pipe(
  Effect.map(([{ gitDir, commonDir }, toplevel]) => ({
    root: toplevel.trim(),
    linked: gitDir !== commonDir,
    mainCheckout: path.dirname(commonDir),
  })),
);

/** Empty on a detached HEAD. */
export const currentBranch = runCommand("git", ["branch", "--show-current"]).pipe(
  Effect.map((output) => output.trim()),
);

/**
 * The same in every checkout: each checkout keeps its per-developer stages in its own `.alchemy/`.
 */
export const stageOf = Effect.fn("Worktree.stageOf")(function* (
  environment: PerDeveloper,
  user: string | undefined,
) {
  return yield* Schema.encodeUnknownEffect(PerDeveloperStage)({
    environment,
    user,
  }).pipe(
    Effect.mapError(
      () =>
        new WorktreeError({
          message: `$USER must be lowercase letters and digits to name a stage, got ${JSON.stringify(user)}`,
        }),
    ),
  );
});

export const stage = (environment: PerDeveloper) => stageOf(environment, process.env.USER);
