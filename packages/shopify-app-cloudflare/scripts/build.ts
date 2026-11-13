#!/usr/bin/env vpx
/**
 * `vp run build` builds the package into `dist/`, ready for `npm publish ./dist`: `package.json`
 * from {@link builtManifest}, an `.mjs` and a `.d.mts` file per module under `dist/dist/`, as
 * `vp pack` emits them from `src/`, the migrations an app copies, `LICENSE` and `README.md`.
 *
 * @module
 */
import path from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { runCommand } from "@mw10013/rigging/core/command";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

export const PACKAGE = path.resolve(import.meta.dirname, "..");

const WORKSPACE = path.resolve(PACKAGE, "../..");

export const OUTPUT = path.join(PACKAGE, "dist");

/** The modules Playwright loads by path from `testDir`, which no export reaches. */
export const E2E_ENTRIES = [
  "src/test/e2e/*.spec.ts",
  "src/test/e2e/*.setup.ts",
  "src/test/e2e/preflight.ts",
] as const;

const Targets = Schema.Record(Schema.String, Schema.String);
const Source = Schema.Struct({ version: Schema.String, exports: Targets, bin: Targets });
const decodeSource = Schema.decodeUnknownSync(Source);

const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeJsonObject = Schema.decodeUnknownEffect(JsonObject);

export const readSource = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* decodeJsonObject(yield* fs.readFileString(path.join(PACKAGE, "package.json")));
});

const built = (target: string, extension: ".d.mts" | ".mjs") =>
  `./dist/${target.replace(/^\.\/src\//u, "").replace(/\.ts$/u, extension)}`;

export const entriesOf = (source: unknown): readonly string[] => {
  const { exports, bin } = decodeSource(source);
  return [...Object.values(exports), ...Object.values(bin), ...E2E_ENTRIES];
};

/** A bin path has no leading `./`: npm 12 drops such a bin from the package it publishes. */
export const builtManifest = (
  source: Record<string, unknown>,
): Record<string, unknown> & {
  readonly version: string;
  readonly files: readonly string[];
  readonly exports: Record<string, { readonly types: string; readonly default: string }>;
  readonly bin: Record<string, string>;
} => {
  const { version, exports, bin } = decodeSource(source);
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
    bin: Object.fromEntries(
      Object.entries(bin).map(([key, target]) => [
        key,
        built(target, ".mjs").replace(/^\.\//u, ""),
      ]),
    ),
  };
};

/** `vp pack` runs in the package, so Rolldown reads its `package.json` and leaves its dependencies and peers external. */
export const build = Effect.fn("Build.build")(function* (outDirectory: string = OUTPUT) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* readSource();
  const entries = entriesOf(source);
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
    path.join(outDirectory, "dist"),
  ]);
  yield* fs.copy(path.join(PACKAGE, "migrations"), path.join(outDirectory, "migrations"));
  yield* fs.copyFile(path.join(WORKSPACE, "LICENSE"), path.join(outDirectory, "LICENSE"));
  yield* fs.copyFile(path.join(PACKAGE, "README.md"), path.join(outDirectory, "README.md"));
  const manifest = builtManifest(source);
  yield* fs.writeFileString(
    path.join(outDirectory, "package.json"),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
  );
  for (const target of Object.values(manifest.bin))
    yield* fs.chmod(path.join(outDirectory, target), 0o755);
  return { directory: outDirectory, version: manifest.version, entries: entries.length };
});

if (import.meta.main)
  NodeRuntime.runMain(
    build().pipe(
      Effect.tap(({ directory, version }) =>
        Effect.logInfo(`Build.build: version=${version} directory=${directory}`),
      ),
      Effect.provide(NodeServices.layer),
    ),
  );
