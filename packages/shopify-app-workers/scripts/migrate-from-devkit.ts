#!/usr/bin/env vpx
import path from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

type Rule = readonly [pattern: RegExp, replacement: string];

const ENDPOINT: Rule = [/\bBOSUN_ENDPOINT\b/gu, "RIGGING_ENDPOINT"];

const RIGGING_SPECIFIERS: readonly Rule[] = [
  [
    /(?<q>["'`])@mw10013\/devkit\/(?<module>(?:core|cloudflare)\/[\w/-]+)\k<q>/gu,
    "$<q>@mw10013/rigging/$<module>$<q>",
  ],
  [
    /(?<q>["'`])#rigging\/(?<module>(?:core|cloudflare)\/[\w/-]+)\.ts\k<q>/gu,
    "$<q>@mw10013/rigging/$<module>$<q>",
  ],
];

const SHOPIFY_SPECIFIER =
  /(?<q>["'`])(?:@mw10013\/devkit|#rigging)\/shopify\/(?<module>[\w-]+?)(?:\.ts)?\k<q>/gu;

export const sourceRules = (self: boolean): readonly Rule[] => [
  ...RIGGING_SPECIFIERS,
  [
    SHOPIFY_SPECIFIER,
    self ? "$<q>#dev/$<module>.ts$<q>" : "$<q>@mw10013/shopify-app-workers/dev/$<module>$<q>",
  ],
  ENDPOINT,
];

export const SCRIPT_RULES: readonly Rule[] = [
  [/\bdevkit-stage\b/gu, "rigging stage"],
  [/\bdevkit-logs\b/gu, "rigging logs"],
  [/\bdevkit-bosun-port\b/gu, "rigging server port"],
  [/\bbosun (?<command>start|stop|status|logs)\b/gu, "rigging server $<command>"],
  ENDPOINT,
];

export const applyRules = (text: string, rules: readonly Rule[]) =>
  rules.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);

export const rewriteManifest = (text: string) => {
  const manifest = JSON.parse(text) as { scripts?: Record<string, string> };
  if (manifest.scripts === undefined) return text;
  const scripts = Object.fromEntries(
    Object.entries(manifest.scripts).map(([name, command]) => [
      name,
      applyRules(command, SCRIPT_RULES),
    ]),
  );
  return Object.entries(scripts).every(([name, command]) => manifest.scripts?.[name] === command)
    ? text
    : `${JSON.stringify({ ...manifest, scripts }, undefined, 2)}\n`;
};

const SOURCE = /\.(?:ts|tsx|mts|js|mjs)$/u;
const SKIPPED = new Set(["node_modules", ".git", "dist", ".alchemy", ".rigging", ".bosun"]);

const filesUnder = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  if ((yield* fs.stat(root)).type === "File") return [path.resolve(root)];
  const entries = yield* fs.readDirectory(root, { recursive: true });
  return entries
    .filter((entry) => !entry.split(path.sep).some((part) => SKIPPED.has(part)))
    .map((entry) => path.resolve(root, entry))
    .filter((file) => SOURCE.test(file) || path.basename(file) === "package.json")
    .filter((file) => file !== import.meta.filename);
});

export const migrate = Effect.fn("MigrateFromDevkit.migrate")(function* (
  roots: readonly string[],
  self: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const changed: string[] = [];
  for (const root of roots)
    for (const file of yield* filesUnder(root)) {
      const text = yield* fs.readFileString(file);
      const next =
        path.basename(file) === "package.json"
          ? rewriteManifest(text)
          : applyRules(text, sourceRules(self));
      if (next === text) continue;
      yield* fs.writeFileString(file, next);
      changed.push(file);
    }
  return changed;
});

const command = Command.make(
  "migrate-from-devkit",
  {
    self: Flag.Boolean("self").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Map the Shopify modules to #dev/<m>.ts, for this package's source"),
    ),
    paths: Argument.String("path").pipe(Argument.variadic()),
  },
  ({ self, paths }) =>
    migrate(paths.length === 0 ? ["."] : paths, self).pipe(
      Effect.flatMap((changed) => Effect.forEach(changed, (file) => Console.log(file))),
    ),
);

if (import.meta.main)
  command.pipe(
    Command.run({ version: "1.0.0" }),
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
