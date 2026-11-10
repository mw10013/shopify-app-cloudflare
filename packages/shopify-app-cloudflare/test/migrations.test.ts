import { cpSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  contractions,
  expectExpandOnly,
  expectMigrationsSynced,
  PACKAGE_MIGRATIONS_DIR,
} from "#test/node/migrations.ts";

describe("N8. the package's migrations only expand", () => {
  it("every package migration passes the expand-only check", () => {
    assert.isNotEmpty(readdirSync(PACKAGE_MIGRATIONS_DIR));
    expectExpandOnly();
  });

  it("the check refuses a drop, a rename, a replace and a not null column without a default", () => {
    const rules = (sql: string) => contractions(sql).map(({ name }) => name);
    assert.deepStrictEqual(rules("drop table AppInstallation;"), ["drop"]);
    assert.deepStrictEqual(rules("alter table AppInstallation drop column scope"), ["drop"]);
    assert.deepStrictEqual(rules("drop index if exists X"), ["drop"]);
    assert.deepStrictEqual(rules("alter table AppInstallation rename column scope to scopes"), [
      "rename",
    ]);
    assert.deepStrictEqual(rules("alter table AppInstallation rename to Installation"), ["rename"]);
    assert.deepStrictEqual(rules("insert or replace into AppInstallation (shop) values ('a')"), [
      "insert or replace",
    ]);
    assert.deepStrictEqual(rules("REPLACE INTO AppInstallation (shop) values ('a')"), [
      "insert or replace",
    ]);
    assert.deepStrictEqual(rules("alter table AppInstallation add column x integer not null"), [
      "not null without a default",
    ]);
    assert.deepStrictEqual(
      rules("alter table AppInstallation add column x text not null default null"),
      ["not null without a default"],
    );
  });

  it("the check refuses any statement that is not an expansion form", () => {
    const rules = (sql: string) => contractions(sql).map(({ name }) => name);
    assert.deepStrictEqual(rules("delete from AppInstallation"), ["not an expansion"]);
    assert.deepStrictEqual(rules("update AppInstallation set scope = null"), ["not an expansion"]);
    assert.deepStrictEqual(
      rules("create unique index if not exists U on AppInstallation (shopGid)"),
      ["not an expansion"],
    );
    assert.deepStrictEqual(rules("create table AppInstallation (shop text)"), ["not an expansion"]);
  });

  it("the check admits a new table, an index, and a nullable or defaulted column, and reads no comment", () => {
    assert.deepStrictEqual(
      contractions(`
        -- drop nothing; rename nothing
        /* insert or replace */
        create table if not exists T (id text primary key, n integer not null);
        create index if not exists TIndex on T (n);
        alter table AppInstallation add column dropAt integer;
        alter table AppInstallation add column x integer not null default 0;
      `),
      [],
    );
  });
});

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
