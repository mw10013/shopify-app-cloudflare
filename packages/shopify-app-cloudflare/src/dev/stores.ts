/**
 * Which store each environment of the app uses, from one place. `dev` and `e2e` lease a pool store
 * to this checkout (`stores acquire`); `staging` and `production` use their stage's one store,
 * {@link storeNameOf}`(stage, 0)`. {@link storeOf} is the answer and {@link adminUrlOf} builds on it.
 *
 * @module
 */
import path from "node:path";

import { type App, app } from "@mw10013/rigging/core/app";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { appHandle } from "./app-handle.ts";
import { handleOf } from "./stores/domain.ts";
import { type Environment, LeasedEnvironment, tomlOf } from "./stores/environments.ts";
import { acquire } from "./stores/lease.ts";
import { Ledger } from "./stores/ledger.ts";
import { storeNameOf } from "./stores/names.ts";
import { checkoutOf, ledgerDirectory, loadPolicy } from "./stores/settings.ts";

export * from "./stores/environments.ts";
export * from "./stores/names.ts";
export { AdoptRefusedError, StorePoolExhaustedError } from "./stores/domain.ts";
export { StateFileInvalidError, UnsupportedFormatError } from "./stores/format.ts";
export { UnknownEnvError } from "./stores/lease.ts";
export { LedgerContendedError } from "./stores/ledger.ts";
export { LedgerDirectoryConflictError } from "./stores/settings.ts";

/** An environment's store, and the app config it runs with. */
export interface EnvironmentStore {
  /** The store's handle, such as `mw10013-pool-00`, which `--store` and admin URLs take. */
  readonly store: string;
  readonly config: string;
}

const isLeased = Schema.is(LeasedEnvironment);

/**
 * The environment's store. `dev` and `e2e` acquire this checkout's lease, which is idempotent, so
 * every reader asks again rather than passing it around. `checkout` is the app, which a config
 * names with `app(import.meta.dirname)`.
 */
export const storeOf = Effect.fn("Stores.storeOf")(function* (
  environment: Environment,
  checkout: App = app(),
) {
  const config = tomlOf(environment);
  if (!isLeased(environment))
    return { store: storeNameOf(environment, 0), config } satisfies EnvironmentStore;
  const lease = yield* acquire(
    yield* loadPolicy(),
    yield* checkoutOf(checkout),
    environment,
    Option.none(),
  ).pipe(Effect.provide(Ledger.layer(yield* ledgerDirectory)));
  return {
    store: handleOf(lease.store.domain),
    config: lease.store.config,
  } satisfies EnvironmentStore;
});

export class AppHandleError extends Schema.TaggedError<AppHandleError>()("AppHandleError", {
  message: Schema.String,
}) {}

/** The embedded app's admin URL on the environment's store; the handle is the environment's toml's. */
export const adminUrlOf = Effect.fn("Stores.adminUrlOf")(function* (
  environment: Environment,
  urlPath: string,
  checkout: App = app(),
) {
  const { store, config } = yield* storeOf(environment, checkout);
  const handle = yield* Effect.try({
    try: () => appHandle(path.join(checkout.root, config)),
    catch: (cause) =>
      new AppHandleError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });
  return `https://admin.shopify.com/store/${store}/apps/${handle}/${urlPath}`;
});
