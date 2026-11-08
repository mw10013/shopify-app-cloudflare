#!/usr/bin/env vpx
/**
 * `vp run release <x.y.z> [--dry-run]` publishes the package as the tag `v<x.y.z>` through
 * `@mw10013/devkit/core/release`, on a commit whose tree holds only the built package:
 * `package.json` from {@link builtManifest}, `dist/`, `migrations/`, `LICENSE` and `README.md`.
 *
 * @module
 */
import path from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as CoreRelease from "@mw10013/devkit/core/release";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";

import { build, builtManifest, PACKAGE, readSource } from "./build.ts";

export const REPO = path.resolve(PACKAGE, "../..");

const TESTBED = path.join(REPO, "apps/testbed");

const VP = path.join(PACKAGE, "node_modules/.bin/vp");

class CheckFailedError extends Data.TaggedError("CheckFailedError")<{
  readonly command: string;
  readonly directory: string;
  readonly exitCode: number;
}> {
  override get message() {
    return `${this.command} failed in ${this.directory} with exit code ${String(this.exitCode)}`;
  }
}

/** Runs `vp <args>` in `directory`, its output on stderr so stdout keeps the release's JSON. */
const vp = Effect.fn("Release.vp")(function* (directory: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const toStderr = (bytes: Uint8Array) =>
    Effect.sync(() => {
      process.stderr.write(bytes);
    });
  const child = yield* spawner.spawn(
    ChildProcess.make(VP, args, { cwd: directory, stdin: "ignore", extendEnv: true }),
  );
  const { exitCode } = yield* Effect.all(
    {
      stdout: Stream.runForEach(child.stdout, toStderr),
      stderr: Stream.runForEach(child.stderr, toStderr),
      exitCode: child.exitCode,
    },
    { concurrency: "unbounded" },
  );
  if (exitCode !== ChildProcessSpawner.ExitCode(0))
    return yield* new CheckFailedError({
      command: ["vp", ...args].join(" "),
      directory,
      exitCode: Number(exitCode),
    });
}, Effect.scoped);

/**
 * The checks a release must pass: the repository's, the package's suite, and the testbed's unit and
 * integ suites, which run the package as an app does. The e2e pack needs a leased store and a
 * Shopify login, so it stays a step of its own.
 */
export const verify = Effect.gen(function* () {
  yield* vp(REPO, ["check"]);
  yield* vp(PACKAGE, ["test", "run"]);
  yield* vp(TESTBED, ["test", "run", "--project", "unit"]);
  yield* vp(TESTBED, ["test", "run", "--project", "integ"]);
});

/** Writes the release tree, except its README, into `directory`. */
export const writeTree = Effect.fn("Release.writeTree")(function* (
  directory: string,
  version: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* readSource();
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* build(path.join(directory, "dist"));
  yield* fs.copy(path.join(PACKAGE, "migrations"), path.join(directory, "migrations"));
  yield* fs.copyFile(path.join(REPO, "LICENSE"), path.join(directory, "LICENSE"));
  yield* fs.writeFileString(
    path.join(directory, "package.json"),
    `${JSON.stringify(builtManifest(source, version), null, 2)}\n`,
  );
});

type Tree = ReturnType<typeof writeTree>;

/**
 * Releases `version` from `repo`, whose `packages/shopify-app-workers` is the source the release
 * names. The tree is built from this checkout's package.
 */
export const release = Effect.fn("Release.release")(function* <E, R>(options: {
  readonly repo: string;
  readonly version: string;
  readonly dryRun: boolean;
  readonly verify: Effect.Effect<void, E, R>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const readme = yield* fs.readFileString(path.join(PACKAGE, "README.md"));
  return yield* CoreRelease.release<E | Effect.Error<Tree>, R | Effect.Services<Tree>>({
    ...options,
    name: "@mw10013/shopify-app-workers",
    tagPrefix: "v",
    sourcePath: "packages/shopify-app-workers",
    readme: () => readme,
    build: writeTree,
  });
});

const command = Command.make(
  "release",
  {
    version: Argument.String("version").pipe(
      Argument.withDescription("The new release, major.minor.patch"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Build and write the release commit, but create no tag and push nothing",
      ),
    ),
  },
  ({ version, dryRun }) =>
    release({ repo: REPO, version, dryRun, verify }).pipe(
      Effect.flatMap((released) => Console.log(JSON.stringify(released, null, 2))),
    ),
);

if (import.meta.main)
  command.pipe(
    Command.run({ version: "1.0.0" }),
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
