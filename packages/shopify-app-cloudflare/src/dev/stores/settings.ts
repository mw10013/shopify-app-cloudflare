import * as os from "node:os";

import type { App } from "@mw10013/rigging/core/app";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { CheckoutPath, MachineName, type Policy, ProjectName } from "./domain.ts";
import { formattedText, readFormatted } from "./format.ts";
import { Pool } from "./pool.ts";

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

export const ledgerDirectory = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* stateDirectory, "shopify-app-cloudflare", "stores", "ledger");
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
