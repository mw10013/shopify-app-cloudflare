/**
 * The package's D1 migrations as an app receives them: committed byte-for-byte copies in the
 * app's own `migrations/` folder, and the checks that hold the copies and the package's own
 * migrations to the production rules.
 *
 * @module
 */
/** The package's own `migrations/` folder. */
export declare const PACKAGE_MIGRATIONS_DIR: string;
/**
 * Asserts that the app's `migrationsDir` holds every package migration, each byte for byte the
 * package's, and no package-named migration the package does not ship. A missing or changed copy
 * fails with the one `cp` command that fixes it, from the package's folder into `migrationsDir`.
 * Imports no test runner: it throws `node:assert`'s `AssertionError`, which every runner reports.
 */
export declare const expectMigrationsSynced: (options: {
  readonly migrationsDir: string;
}) => void;