/**
 * `D1Test`: a D1 database over `node:sqlite`, in memory, migrated from a `migrations/` folder.
 * Node only: the workerd bundle never reaches it.
 *
 * @module
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type * as Workers from "@cloudflare/workers-types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PACKAGE_MIGRATIONS_DIR } from "./migrations.ts";

/** A value as D1 binds it: `undefined` is null and a boolean 1 or 0, which `node:sqlite` refuses. */
const d1Value = (value: unknown) =>
  value === undefined ? null : typeof value === "boolean" ? (value ? 1 : 0) : value;

const d1Meta = (changes = 0, lastRowId = 0) => ({
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: changes,
  last_row_id: lastRowId,
  changed_db: changes > 0,
  changes,
});

const promised = <A>(f: () => A): Promise<A> =>
  new Promise((resolve) => {
    resolve(f());
  });

/**
 * One D1 prepared statement over `node:sqlite`. `bind` answers a new statement, as D1's does:
 * `D1Client` caches a prepared statement and binds it afresh per call.
 */
const d1Statement = (sqlite: DatabaseSync, query: string, values: readonly unknown[] = []) => {
  const prepared = () => sqlite.prepare(query);
  const params = values.map(d1Value) as SQLInputValue[];
  const rows = () =>
    prepared()
      .all(...params)
      .map((row) => ({ ...row }));
  return {
    bind: (...next: unknown[]) => d1Statement(sqlite, query, next),
    first: (column?: string) =>
      promised(() => {
        const row = prepared().get(...params);
        if (row === undefined) return null;
        return column === undefined ? { ...row } : row[column];
      }),
    run: () =>
      promised(() => {
        const result = prepared().run(...params);
        return {
          success: true as const,
          meta: d1Meta(Number(result.changes), Number(result.lastInsertRowid)),
          results: [],
        };
      }),
    all: () => promised(() => ({ success: true as const, meta: d1Meta(), results: rows() })),
    allSync: () => ({ success: true as const, meta: d1Meta(), results: rows() }),
    raw: (options?: { columnNames?: boolean }) =>
      promised(() => {
        const statement = prepared();
        statement.setReturnArrays(true);
        const arrays = statement.all(...params) as unknown as unknown[][];
        return options?.columnNames === true
          ? [statement.columns().map((column) => column.name), ...arrays]
          : arrays;
      }),
  };
};

type D1TestStatement = ReturnType<typeof d1Statement>;

/**
 * A `D1Database` over one `node:sqlite` database, as `D1Client` drives it: `prepare`, `bind`,
 * `all`, `raw`, `run`, `first`, and `batch` in one transaction that rolls back whole on a
 * failure, as D1's implicit batch transaction does.
 */
const d1Database = (sqlite: DatabaseSync) => ({
  prepare: (query: string) => d1Statement(sqlite, query),
  batch: (statements: readonly D1TestStatement[]) =>
    promised(() => {
      sqlite.exec("begin");
      try {
        const results = statements.map((statement) => statement.allSync());
        sqlite.exec("commit");
        return results;
      } catch (error) {
        sqlite.exec("rollback");
        throw error;
      }
    }),
  exec: (query: string) =>
    promised(() => {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    }),
  withSession: () => {
    throw new Error("D1Test: sessions are not supported");
  },
  dump: () => {
    throw new Error("D1Test: dump is not supported");
  },
});

/** The `.sql` files of `migrationsDir`, in the name order Alchemy applies pending migrations in. */
const migrationFiles = (migrationsDir: string) =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()
    .map((name) => path.join(migrationsDir, name));

export interface D1TestShape {
  /** The database as the package's `layerD1` constructors take it. */
  readonly database: Workers.D1Database;
  /** The same database, for a test's own SQL: seeding, an `alter table`, a raw read. */
  readonly sqlite: DatabaseSync;
}

export interface D1TestOptions {
  /** The folder whose `.sql` files run, in name order. By default the package's own `migrations/`. */
  readonly migrationsDir?: string | undefined;
}

/**
 * A fresh in-memory D1 per layer build: `node:sqlite` with `pragma foreign_keys = on`, which D1
 * always enforces, so an app table's `on delete cascade` from `AppInstallation` runs as on D1.
 * An app passes its own `migrations/` folder, so its copy of the package's migration runs too.
 */
export class D1Test extends Context.Service<D1Test, D1TestShape>()("app/D1Test") {
  static readonly make = (options: D1TestOptions = {}): Effect.Effect<D1TestShape> =>
    Effect.sync(() => {
      const sqlite = new DatabaseSync(":memory:");
      sqlite.exec("pragma foreign_keys = on");
      for (const file of migrationFiles(options.migrationsDir ?? PACKAGE_MIGRATIONS_DIR))
        sqlite.exec(readFileSync(file, "utf8"));
      return { sqlite, database: d1Database(sqlite) as unknown as Workers.D1Database };
    });

  static readonly layer = (options: D1TestOptions = {}) =>
    Layer.effect(D1Test, D1Test.make(options));

  /** {@link D1Test}'s database as a `D1DatabaseSource`, for a `layerD1(database)`. */
  static readonly database = Effect.map(Effect.service(D1Test), ({ database }) => database);
}
