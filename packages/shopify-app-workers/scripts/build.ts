#!/usr/bin/env vpx
/**
 * Builds the package into `dist/`: an `.mjs` and a `.d.mts` file per module, as `vp pack` emits
 * them from `src/`. `package.json` is the one list of the public surface: the build's entries are
 * its `exports` targets, and {@link builtManifest} maps each of them into `dist/`, so no second
 * list exists to drift. The e2e pack's specs, setup and preflight are entries by glob, because
 * nothing imports them but Playwright loads them by path.
 *
 * @module
 */
import path from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { runCommand } from "@mw10013/devkit/core/command";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

export const PACKAGE = path.resolve(import.meta.dirname, "..");

/** The package's own build output. */
export const OUTPUT = path.join(PACKAGE, "dist");

/** The modules Playwright loads by path from `testDir`, which no export reaches. */
export const E2E_ENTRIES = [
  "src/test/e2e/*.spec.ts",
  "src/test/e2e/*.setup.ts",
  "src/test/e2e/preflight.ts",
] as const;

const Source = Schema.Struct({ exports: Schema.Record(Schema.String, Schema.String) });
const decodeSource = Schema.decodeUnknownSync(Source);

const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeJsonObject = Schema.decodeUnknownEffect(JsonObject);

/** The source `package.json`, which {@link entriesOf} and {@link builtManifest} read. */
export const readSource = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* decodeJsonObject(yield* fs.readFileString(path.join(PACKAGE, "package.json")));
});

const built = (target: string, extension: ".d.mts" | ".mjs") =>
  `./dist/${target.replace(/^\.\/src\//u, "").replace(/\.ts$/u, extension)}`;

/**
 * The entries {@link build} compiles, relative to the package: every `exports` target, then
 * {@link E2E_ENTRIES}.
 */
export const entriesOf = (source: unknown): readonly string[] => [
  ...Object.values(decodeSource(source).exports),
  ...E2E_ENTRIES,
];

/**
 * The manifest a release tags: the source's, with each export mapped to its types and its code in
 * `dist/` and `files` limited to `dist/` and the migrations an app copies. `imports` serves the
 * source tree alone, `private` keeps the source from being published to a registry by accident,
 * and `devDependencies` and `scripts` serve this workspace.
 */
export const builtManifest = (
  source: Record<string, unknown>,
  version: string,
): Record<string, unknown> & {
  readonly version: string;
  readonly files: readonly string[];
  readonly exports: Record<string, { readonly types: string; readonly default: string }>;
} => {
  const { exports } = decodeSource(source);
  const {
    imports: _imports,
    private: _private,
    devDependencies: _devDependencies,
    scripts: _scripts,
    ...rest
  } = source;
  return {
    ...rest,
    version,
    files: ["dist", "migrations"],
    exports: Object.fromEntries(
      Object.entries(exports).map(([key, target]) => [
        key,
        { types: built(target, ".d.mts"), default: built(target, ".mjs") },
      ]),
    ),
  };
};

/**
 * Builds the package into `outDirectory`, replacing what was there. `vp pack` runs in the package,
 * so Rolldown reads its `package.json` and leaves its dependencies and peers external. It emits no
 * source maps: a map's `sources` would name `src/`, which a release does not hold, and the
 * unbundled modules already mirror their sources one to one.
 */
export const build = Effect.fn("Build.build")(function* (outDirectory: string = OUTPUT) {
  const fs = yield* FileSystem.FileSystem;
  const entries = entriesOf(yield* readSource());
  yield* fs.remove(outDirectory, { recursive: true, force: true });
  yield* runCommand(path.join(PACKAGE, "node_modules/.bin/vp"), [
    "-C",
    PACKAGE,
    "pack",
    ...entries,
    "--unbundle",
    "--dts",
    "--root",
    "src",
    "--no-config",
    "-d",
    outDirectory,
  ]);
  return { directory: outDirectory, entries: entries.length };
});

if (import.meta.main)
  NodeRuntime.runMain(
    build().pipe(
      Effect.tap(({ directory }) => Effect.logInfo(`Build.build: directory=${directory}`)),
      Effect.provide(NodeServices.layer),
    ),
  );
