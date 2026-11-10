/**
 * Where the state lives and who is asking. There is no config file: the organization and the pool's
 * prefix are constants ({@link POOL}), the machine is the host name, and the checkout is the app.
 *
 * @module
 */
import * as os from "node:os";

import type { App } from "@mw10013/rigging/core/app";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CheckoutPath, MachineName, type Policy, ProjectName } from "./domain.ts";
import { formattedText, readFormatted } from "./format.ts";
import { Pool } from "./pool.ts";

/** One app in one checkout: the project is its `package.json` name and the path is its root. */
export interface Checkout {
  readonly path: CheckoutPath;
  readonly project: ProjectName;
}

export const checkoutOf = Effect.fn("Settings.checkoutOf")(function* ({ root, name }: App) {
  const fs = yield* FileSystem.FileSystem;
  return {
    path: CheckoutPath.make(yield* fs.realPath(root).pipe(Effect.orDie)),
    project: ProjectName.make(name),
  } satisfies Checkout;
});

const stateDirectory = Effect.gen(function* () {
  const path = yield* Path.Path;
  return yield* Config.String("XDG_STATE_HOME").pipe(
    Config.withDefault(path.join(os.homedir(), ".local", "state")),
  );
}).pipe(Effect.orDie);

export class LedgerDirectoryConflictError extends Schema.TaggedError<LedgerDirectoryConflictError>()(
  "LedgerDirectoryConflictError",
  { previous: Schema.String, current: Schema.String },
) {
  override get message() {
    return `${this.previous} and ${this.current} are both ledger directories: merge them into ${this.current} by hand and delete ${this.previous}`;
  }
}

const typeOf = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.lstat(file).pipe(
      Effect.map((info) => Option.some(info.type)),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
      Effect.orDie,
    );
  });

const isDirectory = (file: string) =>
  Effect.map(typeOf(file), (type) => Option.exists(type, (type) => type === "Directory"));

/**
 * Moves a ledger left at `previous` to `current`. Apps locked on 0.8.0 read `previous`, so a symlink
 * there keeps them on the same ledger; every run restores a missing one, since a crash between the
 * rename and the symlink would send 0.8.0 to a fresh, empty ledger. The rename is atomic, so of two
 * racing processes the loser finds `current` taken.
 */
const adoptLedger = Effect.fn("Settings.adoptLedger")(function* (
  previous: string,
  current: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const conflict = () =>
    Effect.flatMap(isDirectory(previous), (stillThere) =>
      stillThere ? new LedgerDirectoryConflictError({ previous, current }) : Effect.void,
    );
  if (yield* isDirectory(previous)) {
    if (yield* isDirectory(current)) return yield* conflict();
    yield* fs.makeDirectory(path.dirname(current), { recursive: true }).pipe(Effect.orDie);
    const renamed = yield* fs.rename(previous, current).pipe(
      Effect.as(true),
      Effect.catchTag("PlatformError", () => Effect.succeed(false)),
    );
    if (!renamed) yield* conflict();
  }
  if (Option.isSome(yield* typeOf(previous)) || !(yield* isDirectory(current))) return;
  yield* fs.makeDirectory(path.dirname(previous), { recursive: true }).pipe(Effect.orDie);
  yield* fs.symlink(current, previous).pipe(
    Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
    Effect.orDie,
  );
});

/** Beside `pool.json`, adopting the ledger that 0.8.0 kept under `berth/`. */
export const ledgerDirectory = Effect.gen(function* () {
  const path = yield* Path.Path;
  const state = yield* stateDirectory;
  const current = path.join(state, "shopify-app-cloudflare", "stores", "ledger");
  yield* adoptLedger(path.join(state, "berth", "ledger"), current);
  return current;
});

export const poolFile = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* stateDirectory, "shopify-app-cloudflare", "stores", "pool.json");
});

export const machineName = () => MachineName.make(os.hostname().replace(/\.local$/u, ""));

const EMPTY_POOL: Pool = { stores: [] };

/** A pool that was never written is empty: `stores pool ensure` fills it. */
export const loadPool = Effect.fn("Settings.loadPool")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.orDie))) return EMPTY_POOL;
  return yield* readFormatted(Pool, file, yield* fs.readFileString(file).pipe(Effect.orDie));
});

export const loadPolicy = Effect.fn("Settings.loadPolicy")(function* () {
  return {
    machine: machineName(),
    stores: (yield* loadPool(yield* poolFile)).stores,
  } satisfies Policy;
});

/**
 * Writes the stores on disk, then those of `pool` the disk lacks, so a concurrent run's stores
 * survive. Writes through a temp file and a rename, so a reader never sees a partial file. Returns
 * the pool written and whether the file changed: one that already holds it is not written.
 */
export const savePool = Effect.fn("Settings.savePool")(function* (file: string, pool: Pool) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const disk = yield* loadPool(file);
  const merged: Pool = {
    ...disk,
    stores: [...disk.stores, ...pool.stores.filter((store) => !disk.stores.includes(store))],
  };
  const text = formattedText(Pool, merged);
  if (formattedText(Pool, disk) === text && (yield* fs.exists(file).pipe(Effect.orDie)))
    return { pool: merged, changed: false };
  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.orDie);
  const temp = `${file}.${String(process.pid)}.tmp`;
  yield* fs.writeFileString(temp, text).pipe(Effect.orDie);
  yield* fs.rename(temp, file).pipe(Effect.orDie);
  return { pool: merged, changed: true };
});
