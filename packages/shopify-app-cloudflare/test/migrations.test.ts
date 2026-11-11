import { cpSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { expectMigrationsSynced, PACKAGE_MIGRATIONS_DIR } from "#test/node/migrations.ts";

describe("expectMigrationsSynced", () => {
  const appMigrations = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sac-migrations-"));
    cpSync(PACKAGE_MIGRATIONS_DIR, dir, { recursive: true });
    writeFileSync(path.join(dir, "0001_app_note.sql"), "create table Note (id integer);\n");
    return dir;
  };
  const failure = (migrationsDir: string) => {
    try {
      expectMigrationsSynced({ migrationsDir });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return assert.fail("expectMigrationsSynced passed");
  };
  const NAME = "0000_sac_01_app_installation.sql";

  it("passes for byte-identical copies beside the app's own migrations", () => {
    expectMigrationsSynced({ migrationsDir: appMigrations() });
  });

  it("fails on a changed copy with the cp that fixes it, and passes once that cp runs", () => {
    const dir = appMigrations();
    writeFileSync(path.join(dir, NAME), "create table AppInstallation (shop text);\n");
    const message = failure(dir);
    assert.include(message, `cp ${path.join(PACKAGE_MIGRATIONS_DIR, NAME)} ${dir}/`);
    cpSync(path.join(PACKAGE_MIGRATIONS_DIR, NAME), path.join(dir, NAME));
    expectMigrationsSynced({ migrationsDir: dir });
  });

  it("fails on a missing copy with the cp that fixes it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sac-migrations-"));
    const shipped = readdirSync(PACKAGE_MIGRATIONS_DIR)
      .toSorted()
      .map((name) => path.join(PACKAGE_MIGRATIONS_DIR, name));
    assert.include(failure(dir), `cp ${shipped.join(" ")} ${dir}/`);
  });

  it("fails on a package-named migration the package does not ship", () => {
    const dir = appMigrations();
    writeFileSync(path.join(dir, "0000_sac_99_gone.sql"), "select 1;\n");
    assert.include(failure(dir), "0000_sac_99_gone.sql named as the package's");
  });
});
