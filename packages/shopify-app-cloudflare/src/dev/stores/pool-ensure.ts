import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { domainOf, handleOf, type StoreDomain } from "./domain.ts";
import { planPool, type Pool, POOL, type PoolSource } from "./pool.ts";
import { loadPool, savePool } from "./settings.ts";
import { ShopifyCli } from "./shopify-cli.ts";

/** Shopify gave the new store a suffixed domain because its name was taken. */
export class StoreDomainTakenError extends Schema.TaggedError<StoreDomainTakenError>()(
  "StoreDomainTakenError",
  { name: Schema.String, domain: Schema.String },
) {
  override get message() {
    return `shopify created ${this.name} at ${this.domain}, not ${this.name}.myshopify.com; the pool left it out`;
  }
}

export interface Ensured {
  readonly pool: Pool;
  readonly adopted: readonly StoreDomain[];
  readonly created: readonly StoreDomain[];
}

/**
 * Creates one store at a time and writes the pool after each, so a failed run keeps every store it
 * made and `acquire` never sees a store that does not exist. Each write keeps the stores a
 * concurrent run wrote meanwhile, and the result is the pool last written.
 */
export const ensure = Effect.fn("PoolEnsure.ensure")(function* (
  file: string,
  count: Option.Option<number>,
  source: PoolSource = POOL,
) {
  const shopify = yield* ShopifyCli;
  const listed = yield* loadPool(file);
  const orgStores = yield* shopify.listStores(source.organization);
  const plan = yield* planPool({
    listed: listed.stores,
    orgStores,
    prefix: source.prefix,
    count: Option.getOrElse(count, () => 0),
  });
  for (const domain of listed.stores) yield* Console.error(`ok       ${handleOf(domain)}`);
  for (const domain of plan.adopt) yield* Console.error(`adopted  ${handleOf(domain)}`);

  let saved = yield* savePool(file, {
    ...listed,
    stores: [...listed.stores, ...plan.adopt],
  });
  const created: StoreDomain[] = [];
  for (const name of plan.create) {
    const domain = yield* shopify.createDevStore(source.organization, name);
    if (domain !== domainOf(name)) return yield* new StoreDomainTakenError({ name, domain });
    created.push(domainOf(name));
    saved = yield* savePool(file, {
      ...saved.pool,
      stores: [...saved.pool.stores, domainOf(name)],
    });
    yield* Console.error(`created  ${name}`);
  }
  return { pool: saved.pool, adopted: plan.adopt, created } satisfies Ensured;
});
