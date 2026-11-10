/**
 * The testbed's shop actor: one Durable Object per shop, built by the package's `ShopActorKit`,
 * holding a counter. It exists to run the kit in workerd: the socket, the gate, notices,
 * uninstall and revoke.
 *
 * @module
 */

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import { ShopActorKit, type ShopActorShape } from "@mw10013/shopify-app-cloudflare/backend";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { COUNT_KEY, CounterRpcs } from "#contract/counter.ts";

/** What the Backend calls on the stub beside the kit's lifecycle: the App Home's server read. */
interface CounterMethods {
  readonly getCount: () => Effect.Effect<number>;
}

/** The class name stays `ShopActor`: a Durable Object class rename blocks a Workers rollback. */
export class ShopActor extends Cloudflare.DurableObject<
  ShopActor,
  ShopActorShape<CounterMethods>
>()("ShopActor") {}

/** One row, seeded, so every read is a select and every write an update. */
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

/** {@link ShopActor}'s implementation, provided in the Backend's init above `AppInstallations`. */
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
