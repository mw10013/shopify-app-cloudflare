/**
 * The package's D1 migrations as an app receives them: committed byte-for-byte copies in the
 * app's own `migrations/` folder, and the checks that hold the copies and the package's own
 * migrations to the production rules.
 *
 * @module
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The package's own `migrations/` folder. */
export const PACKAGE_MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../migrations", import.meta.url),
);

/**
 * The name prefix of every package migration. Alchemy applies pending migrations in name order
 * and keys applied history by name, so `0000_` runs before an app's `0001_` on a fresh database
 * (an app table's foreign key finds its parent), and `swa` marks the file as the package's.
 */
export const PACKAGE_MIGRATION_PREFIX = "0000_swa_";

const packageMigrationNames = (migrationsDir: string) =>
  readdirSync(migrationsDir)
    .filter((name) => name.startsWith(PACKAGE_MIGRATION_PREFIX) && name.endsWith(".sql"))
    .toSorted();

/** `value` as one shell word. */
const shellWord = (value: string) =>
  /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Asserts that the app's `migrationsDir` holds every package migration, each byte for byte the
 * package's, and no package-named migration the package does not ship. A missing or changed copy
 * fails with the one `cp` command that fixes it, from the package's folder into `migrationsDir`.
 * Imports no test runner: it throws `node:assert`'s `AssertionError`, which every runner reports.
 */
export const expectMigrationsSynced = (options: { readonly migrationsDir: string }) => {
  const migrationsDir = path.resolve(options.migrationsDir);
  const shipped = packageMigrationNames(PACKAGE_MIGRATIONS_DIR);
  const stale = packageMigrationNames(migrationsDir).filter((name) => !shipped.includes(name));
  const outOfDate = shipped.filter((name) => {
    const copy = path.join(migrationsDir, name);
    return (
      !existsSync(copy) ||
      !readFileSync(copy).equals(readFileSync(path.join(PACKAGE_MIGRATIONS_DIR, name)))
    );
  });
  const problems = [
    ...(outOfDate.length === 0
      ? []
      : [
          `${outOfDate.join(", ")} missing or not the package's. Fix with:\n  cp ${[
            ...outOfDate.map((name) => path.join(PACKAGE_MIGRATIONS_DIR, name)),
            `${migrationsDir}/`,
          ]
            .map(shellWord)
            .join(" ")}`,
        ]),
    ...(stale.length === 0
      ? []
      : [
          `${stale.join(", ")} named as the package's, which ships no such migration: rename it out of the ${PACKAGE_MIGRATION_PREFIX} band.`,
        ]),
  ];
  assert.ok(
    problems.length === 0,
    `${migrationsDir} is out of sync with @mw10013/shopify-app-workers:\n${problems.join("\n")}`,
  );
};

/** `sql` without its comments, as statements, each lowercased with its whitespace collapsed. */
const statements = (sql: string) =>
  sql
    .replaceAll(/\/\*[\s\S]*?\*\//gu, " ")
    .replaceAll(/--[^\n]*/gu, " ")
    .split(";")
    .map((statement) => statement.replaceAll(/\s+/gu, " ").trim().toLowerCase())
    .filter((statement) => statement.length > 0);

/** The ways a statement contracts the schema, each with what catches it. */
const CONTRACTIONS: readonly { readonly name: string; readonly test: (s: string) => boolean }[] = [
  { name: "drop", test: (s) => /\bdrop\b/u.test(s) },
  { name: "rename", test: (s) => /\brename\b/u.test(s) },
  {
    name: "insert or replace",
    test: (s) => /\b(?:insert\s+or\s+replace|replace\s+into)\b/u.test(s),
  },
  {
    name: "not null without a default",
    test: (s) =>
      /^alter\s+table\b.*\badd\b/u.test(s) && /\bnot\s+null\b/u.test(s) && !/\bdefault\b/u.test(s),
  },
];

/**
 * Each statement of `sql` that breaks expand-before-contract, with the rule it breaks: a drop, a
 * rename, an `insert or replace` (a delete that cascades), or a column added `not null` with no
 * default, which the previous app version's inserts would fail. Creating a table or an index,
 * and adding a nullable or defaulted column, are expansions.
 */
export const contractions = (sql: string) =>
  statements(sql).flatMap((statement) =>
    CONTRACTIONS.filter(({ test }) => test(statement)).map(({ name }) => ({ name, statement })),
  );

/** Asserts that every package migration in `migrationsDir` only expands the schema. */
export const expectExpandOnly = (migrationsDir = PACKAGE_MIGRATIONS_DIR) => {
  const found = packageMigrationNames(migrationsDir).flatMap((name) =>
    contractions(readFileSync(path.join(migrationsDir, name), "utf8")).map(
      ({ name: rule, statement }) => `${name}: ${rule}: ${statement}`,
    ),
  );
  assert.deepStrictEqual(found, [], "a package migration contracts the schema");
};
