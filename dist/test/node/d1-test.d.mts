import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DatabaseSync } from "node:sqlite";
import * as Workers from "@cloudflare/workers-types";
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
declare const D1Test_base: Context.ServiceClass<D1Test, "app/D1Test", D1TestShape>;
/**
 * A fresh in-memory D1 per layer build: `node:sqlite` with `pragma foreign_keys = on`, which D1
 * always enforces, so an app table's `on delete cascade` from `AppInstallation` runs as on D1.
 * An app passes its own `migrations/` folder, so its copy of the package's migration runs too.
 */
export declare class D1Test extends D1Test_base {
  static readonly make: (options?: D1TestOptions) => Effect.Effect<D1TestShape>;
  static readonly layer: (options?: D1TestOptions) => Layer.Layer<D1Test, never, never>;
  /** {@link D1Test}'s database as a `D1DatabaseSource`, for a `layerD1(database)`. */
  static readonly database: Effect.Effect<Workers.D1Database, never, D1Test>;
}
export {};