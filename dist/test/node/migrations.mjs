import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// src/test/node/migrations.ts
/**
* The package's D1 migrations as an app receives them: committed byte-for-byte copies in the
* app's own `migrations/` folder, and the checks that hold the copies and the package's own
* migrations to the production rules.
*
* @module
*/
/** The package's own `migrations/` folder. */
const PACKAGE_MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations", import.meta.url));
/**
* The name prefix of every package migration. Alchemy applies pending migrations in name order
* and keys applied history by name, so `0000_` runs before an app's `0001_` on a fresh database
* (an app table's foreign key finds its parent), and `swa` marks the file as the package's.
*/
const PACKAGE_MIGRATION_PREFIX = "0000_swa_";
const packageMigrationNames = (migrationsDir) => readdirSync(migrationsDir).filter((name) => name.startsWith("0000_swa_") && name.endsWith(".sql")).toSorted();
/** `value` as one shell word. */
const shellWord = (value) => /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`;
/**
* Asserts that the app's `migrationsDir` holds every package migration, each byte for byte the
* package's, and no package-named migration the package does not ship. A missing or changed copy
* fails with the one `cp` command that fixes it, from the package's folder into `migrationsDir`.
* Imports no test runner: it throws `node:assert`'s `AssertionError`, which every runner reports.
*/
const expectMigrationsSynced = (options) => {
	const migrationsDir = path.resolve(options.migrationsDir);
	const shipped = packageMigrationNames(PACKAGE_MIGRATIONS_DIR);
	const stale = packageMigrationNames(migrationsDir).filter((name) => !shipped.includes(name));
	const outOfDate = shipped.filter((name) => {
		const copy = path.join(migrationsDir, name);
		return !existsSync(copy) || !readFileSync(copy).equals(readFileSync(path.join(PACKAGE_MIGRATIONS_DIR, name)));
	});
	const problems = [...outOfDate.length === 0 ? [] : [`${outOfDate.join(", ")} missing or not the package's. Fix with:\n  cp ${[...outOfDate.map((name) => path.join(PACKAGE_MIGRATIONS_DIR, name)), `${migrationsDir}/`].map(shellWord).join(" ")}`], ...stale.length === 0 ? [] : [`${stale.join(", ")} named as the package's, which ships no such migration: rename it out of the ${PACKAGE_MIGRATION_PREFIX} band.`]];
	assert.ok(problems.length === 0, `${migrationsDir} is out of sync with @mw10013/shopify-app-workers:\n${problems.join("\n")}`);
};
export { PACKAGE_MIGRATIONS_DIR, PACKAGE_MIGRATION_PREFIX, expectMigrationsSynced };
