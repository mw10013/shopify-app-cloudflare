/**
 * Nothing here touches the file system or the clock: the shell gathers facts and hands them in.
 * The one stored value is {@link State}; who holds a store and which leases are stale are derived
 * from it, never stored.
 *
 * @module
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The app's `package.json` name. */
export const ProjectName = Schema.NonEmptyString.pipe(Schema.brand("ProjectName"));
export type ProjectName = typeof ProjectName.Type;

export const EnvName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u)).pipe(
  Schema.brand("EnvName"),
);
export type EnvName = typeof EnvName.Type;

/** Real (symlinks resolved) and absolute. */
export const CheckoutPath = Schema.String.check(Schema.isPattern(/^(?:\/|[A-Za-z]:\\)/u)).pipe(
  Schema.brand("CheckoutPath"),
);
export type CheckoutPath = typeof CheckoutPath.Type;

export const MachineName = Schema.NonEmptyString.pipe(Schema.brand("MachineName"));
export type MachineName = typeof MachineName.Type;

export const StoreDomain = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u),
).pipe(Schema.brand("StoreDomain"));
export type StoreDomain = typeof StoreDomain.Type;

export const handleOf = (domain: StoreDomain): string => domain.slice(0, -".myshopify.com".length);

export const domainOf = (handle: string): StoreDomain =>
  StoreDomain.make(`${handle}.myshopify.com`);

export interface Policy {
  readonly machine: MachineName;
  readonly stores: readonly StoreDomain[];
}

/**
 * A lease's identity. `project` is not part of it: one path holds one app, so a rename keeps the
 * lease.
 */
export const LeaseKey = Schema.Struct({
  machine: MachineName,
  checkout: CheckoutPath,
  env: EnvName,
});
export type LeaseKey = typeof LeaseKey.Type;

/**
 * A struct that keeps the fields it does not name, so a field another writer added, an older
 * generation's `ports` included, survives this one's rewrite.
 */
const Open = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);

export const StoreGrant = Open({
  domain: StoreDomain,
  config: Schema.NonEmptyString,
});
export type StoreGrant = typeof StoreGrant.Type;

export const Lease = Open({
  key: LeaseKey,
  project: ProjectName,
  store: StoreGrant,
  acquiredAt: Schema.DateTimeUtcFromString,
});
export type Lease = typeof Lease.Type;

export const State = Open({ leases: Schema.Array(Lease) });
export type State = typeof State.Type;

export const EMPTY_STATE: State = { leases: [] };

export const sameKey = (a: LeaseKey, b: LeaseKey): boolean =>
  a.machine === b.machine && a.checkout === b.checkout && a.env === b.env;

const describeKey = (key: LeaseKey) => `${key.machine}:${key.checkout} ${key.env}`;

export const checkState = (state: State): Option.Option<string> => {
  const keys = new Set<string>();
  const stores = new Map<StoreDomain, string>();
  for (const lease of state.leases) {
    const key = describeKey(lease.key);
    if (keys.has(key)) return Option.some(`lease ${key} appears twice`);
    keys.add(key);
    const other = stores.get(lease.store.domain);
    if (other !== undefined)
      return Option.some(`store ${lease.store.domain} is held by ${other} and ${key}`);
    stores.set(lease.store.domain, key);
  }
  return Option.none();
};

export const staleLeases = (
  state: State,
  machine: MachineName,
  gone: ReadonlySet<CheckoutPath>,
): readonly Lease[] =>
  state.leases.filter((lease) => lease.key.machine === machine && gone.has(lease.key.checkout));

export const release = (state: State, keys: readonly LeaseKey[]): State => ({
  ...state,
  leases: state.leases.filter((lease) => !keys.some((key) => sameKey(key, lease.key))),
});

export const sweep = (state: State, machine: MachineName, gone: ReadonlySet<CheckoutPath>): State =>
  release(
    state,
    staleLeases(state, machine, gone).map((lease) => lease.key),
  );

const holders = (state: State): ReadonlyMap<StoreDomain, Lease> =>
  new Map(state.leases.map((lease) => [lease.store.domain, lease]));

export const holderOf = (state: State, domain: StoreDomain): Option.Option<Lease> =>
  Option.fromNullishOr(holders(state).get(domain));

export const pickStore = (
  state: State,
  stores: readonly StoreDomain[],
): Option.Option<StoreDomain> => {
  const held = holders(state);
  return Option.fromNullishOr(stores.find((domain) => !held.has(domain)));
};

export interface Request {
  readonly key: LeaseKey;
  readonly project: ProjectName;
  /** The app config file the environment's `shopify app dev` runs with. */
  readonly config: string;
  readonly adopt: Option.Option<StoreDomain>;
}

export interface Facts {
  readonly policy: Policy;
  readonly now: Lease["acquiredAt"];
}

export class AdoptRefusedError extends Schema.TaggedError<AdoptRefusedError>()(
  "AdoptRefusedError",
  {
    value: Schema.String,
    reason: Schema.Literals(["held", "not-in-pool"]),
  },
) {
  override get message() {
    return `cannot adopt ${this.value}: ${this.reason}`;
  }
}

/** `stores pool ensure <count>` grows the pool. */
export class StorePoolExhaustedError extends Schema.TaggedError<StorePoolExhaustedError>()(
  "StorePoolExhaustedError",
  { stores: Schema.Int },
) {
  override get message() {
    return this.stores === 0
      ? "the store pool is empty: run stores pool ensure"
      : `all ${String(this.stores)} stores in the pool are leased: stores pool ensure <count> grows it`;
  }
}

/**
 * A lease that already matches comes back unchanged, so the ledger skips the write. The held lease
 * is the base of the next one, so a field a newer writer added to it survives.
 */
export const reconcile = Effect.fn("Domain.reconcile")(function* (
  state: State,
  request: Request,
  facts: Facts,
): Effect.fn.Return<
  { readonly state: State; readonly lease: Lease },
  AdoptRefusedError | StorePoolExhaustedError
> {
  const { key, adopt } = request;
  const stores = facts.policy.stores;
  const current = Option.fromNullishOr(state.leases.find((lease) => sameKey(lease.key, key)));
  const domain = yield* Option.match(adopt, {
    onSome: (domain) => {
      const value = `store=${handleOf(domain)}`;
      if (!stores.includes(domain))
        return Effect.fail(new AdoptRefusedError({ value, reason: "not-in-pool" }));
      if (Option.exists(holderOf(state, domain), (holder) => !sameKey(holder.key, key)))
        return Effect.fail(new AdoptRefusedError({ value, reason: "held" }));
      return Effect.succeed(domain);
    },
    onNone: () =>
      Option.match(
        Option.filter(
          Option.map(current, (lease) => lease.store.domain),
          (domain) => stores.includes(domain),
        ),
        {
          onSome: Effect.succeed,
          onNone: () =>
            Option.match(pickStore(state, stores), {
              onSome: Effect.succeed,
              onNone: () => Effect.fail(new StorePoolExhaustedError({ stores: stores.length })),
            }),
        },
      ),
  });

  const lease: Lease = Option.match(current, {
    onNone: () => ({
      key,
      project: request.project,
      store: { domain, config: request.config },
      acquiredAt: facts.now,
    }),
    onSome: (held) => ({
      ...held,
      key,
      project: request.project,
      store: { ...held.store, domain, config: request.config },
    }),
  });
  const leases = Option.isSome(current)
    ? state.leases.map((held) => (sameKey(held.key, key) ? lease : held))
    : [...state.leases, lease];
  return { state: { ...state, leases }, lease };
});
