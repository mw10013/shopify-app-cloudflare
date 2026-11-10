import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  type CheckoutPath,
  EnvName,
  holderOf,
  type Lease,
  type Policy,
  reconcile,
  release as releaseLeases,
  sameKey,
  staleLeases,
  type State,
  type StoreDomain,
  sweep,
} from "./domain.ts";
import { LeasedEnvironment, tomlOf } from "./environments.ts";
import { Ledger } from "./ledger.ts";
import type { Checkout } from "./settings.ts";
import * as Shopify from "./shopify-cli.ts";

export class UnknownEnvError extends Schema.TaggedError<UnknownEnvError>()("UnknownEnvError", {
  env: Schema.String,
}) {
  override get message() {
    return `${this.env} leases no store: only ${LeasedEnvironment.literals.join(" and ")} do`;
  }
}

export class LeaseInUseError extends Schema.TaggedError<LeaseInUseError>()("LeaseInUseError", {
  env: Schema.String,
  store: Schema.String,
  pid: Schema.Int,
}) {
  override get message() {
    return `shopify app dev (pid ${String(this.pid)}) is running on ${this.store} for ${this.env}; stop it, then release`;
  }
}

export interface Holding {
  readonly lease: Lease;
  readonly stale: boolean;
}

export interface PooledStore {
  readonly domain: StoreDomain;
  readonly holder: Option.Option<Lease>;
}

const goneCheckouts = Effect.fn("Lease.goneCheckouts")(function* (policy: Policy, state: State) {
  const fs = yield* FileSystem.FileSystem;
  const gone = new Set<CheckoutPath>();
  for (const lease of state.leases)
    if (
      lease.key.machine === policy.machine &&
      !(yield* fs.exists(lease.key.checkout).pipe(Effect.orDie))
    )
      gone.add(lease.key.checkout);
  return gone;
});

const modifySwept = Effect.fn("Lease.modifySwept")(function* <A, E>(
  policy: Policy,
  transition: (state: State) => Effect.Effect<{ readonly state: State; readonly value: A }, E>,
) {
  const committed = yield* (yield* Ledger).modify((state) =>
    Effect.gen(function* () {
      const gone = yield* goneCheckouts(policy, state);
      const next = yield* transition(sweep(state, policy.machine, gone));
      return {
        state: next.state,
        value: {
          value: next.value,
          swept: staleLeases(state, policy.machine, gone),
        },
      };
    }),
  );
  for (const lease of committed.value.swept)
    yield* Console.error(
      `stores: swept ${lease.project} ${lease.key.env} at ${lease.key.checkout}: the checkout is gone`,
    );
  return committed.value.value;
});

const leasedEnv = (envName: string) =>
  Option.match(Schema.decodeUnknownOption(LeasedEnvironment)(envName), {
    onNone: () => Effect.fail(new UnknownEnvError({ env: envName })),
    onSome: Effect.succeed,
  });

export const acquire = Effect.fn("Lease.acquire")(function* (
  policy: Policy,
  checkout: Checkout,
  envName: string,
  adopt: Option.Option<StoreDomain>,
) {
  const env = yield* leasedEnv(envName);
  const now = yield* DateTime.now;
  const request = {
    key: { machine: policy.machine, checkout: checkout.path, env: EnvName.make(env) },
    project: checkout.project,
    config: tomlOf(env),
    adopt,
  };
  return yield* modifySwept(policy, (state) =>
    Effect.map(reconcile(state, request, { policy, now }), ({ state, lease }) => ({
      state,
      value: lease,
    })),
  );
});

/**
 * Any env is releasable, one that no longer leases included. Refuses while this checkout's
 * `shopify app dev` runs on a leased store, so a store is never leased to a second checkout while
 * the first still runs on it. The store's dev preview stays: the next holder's `shopify app dev`
 * replaces it.
 */
export const release = Effect.fn("Lease.release")(function* (
  policy: Policy,
  checkout: Checkout,
  env: Option.Option<string>,
) {
  const held = (yield* (yield* Ledger).read).leases.filter(
    (lease) =>
      lease.key.machine === policy.machine &&
      lease.key.checkout === checkout.path &&
      Option.match(env, {
        onNone: () => true,
        onSome: (env) => lease.key.env === env,
      }),
  );
  for (const lease of held) {
    const pid = yield* Shopify.liveSession(checkout.path, lease.store.domain);
    if (Option.isSome(pid))
      return yield* new LeaseInUseError({
        env: lease.key.env,
        store: lease.store.domain,
        pid: pid.value,
      });
  }
  yield* modifySwept(policy, (state) =>
    Effect.succeed({
      state: releaseLeases(
        state,
        held.map((lease) => lease.key),
      ),
      value: 0,
    }),
  );
  return held;
});

/**
 * Never writes: a command that only stops what a lease started asks this, so a checkout without
 * one is not granted a store on its way out.
 */
export const show = Effect.fn("Lease.show")(function* (
  policy: Policy,
  checkout: Checkout,
  envName: string,
) {
  const env = yield* leasedEnv(envName);
  const key = { machine: policy.machine, checkout: checkout.path, env: EnvName.make(env) };
  return Option.fromNullishOr(
    (yield* (yield* Ledger).read).leases.find((lease) => sameKey(lease.key, key)),
  );
});

export interface Listing {
  readonly holdings: readonly Holding[];
  readonly stores: readonly PooledStore[];
}

export const list = Effect.fn("Lease.list")(function* (policy: Policy) {
  const state = yield* (yield* Ledger).read;
  const gone = yield* goneCheckouts(policy, state);
  const stale = staleLeases(state, policy.machine, gone);
  return {
    holdings: state.leases.map((lease): Holding => ({
      lease,
      stale: stale.some((held) => sameKey(held.key, lease.key)),
    })),
    stores: policy.stores.map((domain): PooledStore => ({
      domain,
      holder: holderOf(state, domain),
    })),
  } satisfies Listing;
});
