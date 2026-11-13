import * as Cloudflare from "@alchemy.run/cloudflare";
import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import { ShopActorKit, type ShopActorShape } from "@mw10013/shopify-app-cloudflare/backend";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { COUNT_KEY, CounterRpcs } from "#contract/counter.ts";

interface CounterMethods {
  readonly getCount: () => Effect.Effect<number>;
}

/** The class name stays `ShopActor`: a Durable Object class rename blocks a Workers rollback. */
export class ShopActor extends Cloudflare.DurableObject<
  ShopActor,
  ShopActorShape<CounterMethods>
>()("ShopActor") {}

const migrations = SqliteMigrator.fromRecord({
  "0001_counter": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      create table if not exists Counter (
        id integer primary key check (id = 1),
        count integer not null default 0
      )
    `;
    yield* sql`insert or ignore into Counter (id) values (1)`;
  }),
});

export const ShopActorLive = ShopActor.make(
  ShopActorKit.make({
    rpcs: CounterRpcs,
    migrations,
    build: ({ sql, notify }) =>
      Effect.sync(() => {
        const getCount = sql<{
          readonly count: number;
        }>`select count from Counter where id = 1`.pipe(
          Effect.map((rows) => rows[0]?.count ?? 0),
          Effect.orDie,
        );
        const increment = sql<{
          readonly count: number;
        }>`update Counter set count = count + 1 where id = 1 returning count`.pipe(
          Effect.map((rows) => rows[0]?.count ?? 0),
          Effect.orDie,
          Effect.tap(() => notify([COUNT_KEY])),
        );
        return {
          handlers: CounterRpcs.toLayer({
            MerchantGetCount: () => getCount,
            MerchantIncrement: () => increment,
          }),
          methods: { getCount: () => getCount },
        };
      }),
  }),
);
