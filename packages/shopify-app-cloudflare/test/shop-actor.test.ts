import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Migrator from "@effect/sql-sqlite-do/SqliteMigrator";
import { assert, describe, it } from "@effect/vitest";
import {
  actorUpgrade,
  refusalClose,
  ShopActorKit,
  ShopActors,
  type ShopActorShape,
  type SocketIdentity,
} from "@mw10013/shopify-app-cloudflare/backend";
import { makeNoticesAtom, shopActorProtocol } from "@mw10013/shopify-app-cloudflare/client";
import {
  CONNECTION_CLOSE_NOT_A_MEMBER,
  ConnectionMiddleware,
  RequireMerchant,
} from "@mw10013/shopify-app-cloudflare/contract";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as AtomRpc from "effect/reactivity/AtomRpc";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { logDefect } from "#internal/defects.ts";
import { ABORT_UNINSTALLED, ShopNotInstalledError } from "#internal/shop-actor-kit.ts";
import { settleDestroy } from "#internal/shop-actors.ts";

import { capturingLogs, type Logged } from "./logs.ts";

const logDefectOfGet = logDefect("ShopActor.MerchantGet: shop=a.myshopify.com", {
  shop: "a.myshopify.com",
});

describe("logDefect", () => {
  it.effect("logs a defect at Error with the operation, and re-raises it", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const exit = yield* logDefectOfGet(Effect.die(new Error("boom"))).pipe(
        Effect.exit,
        capturingLogs(logged),
      );
      assert.isTrue(Exit.hasDies(exit));
      assert.deepStrictEqual(logged, [
        { level: "Error", message: "ShopActor.MerchantGet: shop=a.myshopify.com: defect" },
      ]);
    }),
  );

  it.effect("passes a typed failure and a success through unlogged", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const failed = yield* logDefectOfGet(Effect.fail("expected")).pipe(
        Effect.exit,
        capturingLogs(logged),
      );
      const value = yield* logDefectOfGet(Effect.succeed(2)).pipe(capturingLogs(logged));
      assert.deepStrictEqual(failed, Exit.fail("expected"));
      assert.strictEqual(value, 2);
      assert.deepStrictEqual(logged, []);
    }),
  );
});

const rejected = (cause: Error) =>
  Effect.fail(
    new Cloudflare.RpcCallError({ method: "destroy", cause }),
  ) as unknown as Effect.Effect<void>;

const settled = (call: Effect.Effect<void>) =>
  Effect.map(Effect.exit(settleDestroy({ shop: "a.myshopify.com" }, call)), Exit.isSuccess);

describe("ShopActors.destroy's settle", () => {
  it.effect("workerd's reset with the uninstall reason is success", () =>
    Effect.gen(function* () {
      const reset = Object.assign(new Error(ABORT_UNINSTALLED), { durableObjectReset: true });
      assert.isTrue(yield* settled(rejected(reset)));
    }),
  );

  it.effect("an Error with the reason as its message but no reset flag fails", () =>
    Effect.gen(function* () {
      assert.isFalse(yield* settled(rejected(new Error(ABORT_UNINSTALLED))));
    }),
  );

  it.effect("the refusal to activate is success, matched by its tag", () =>
    Effect.gen(function* () {
      assert.isTrue(
        yield* settled(rejected(new ShopNotInstalledError({ shop: "a.myshopify.com" }))),
      );
    }),
  );

  it.effect("an Error carrying the refusal's message but not its tag fails", () =>
    Effect.gen(function* () {
      const message = new ShopNotInstalledError({ shop: "a.myshopify.com" }).message;
      assert.isFalse(yield* settled(rejected(new Error(message))));
    }),
  );
});

const Counter = Schema.Struct({ value: Schema.Number });

const CounterRpcs = RpcGroup.make(
  Rpc.make("MerchantGetCounter", { success: Counter }),
  Rpc.make("MerchantIncrement"),
)
  .middleware(RequireMerchant)
  .middleware(ConnectionMiddleware);

interface CounterMethods {
  readonly getCounter: () => Effect.Effect<typeof Counter.Encoded>;
}

class ShopActor extends Cloudflare.DurableObject<ShopActor, ShopActorShape<CounterMethods>>()(
  "ShopActor",
) {}

const ShopActorLive = ShopActor.make(
  ShopActorKit.make({
    rpcs: CounterRpcs,
    migrations: Migrator.fromRecord({ "0001_init": Effect.void }),
    build: ({ notify }) =>
      Effect.succeed({
        handlers: CounterRpcs.toLayer({
          MerchantGetCounter: () => Effect.succeed({ value: 0 }),
          MerchantIncrement: () => notify(["counter"]),
        }),
        methods: { getCounter: () => Effect.succeed({ value: 0 }) },
      }),
  }),
);

const MemberCaller = Schema.Struct({ role: Schema.Literal("member"), memberId: Schema.String });

const MemberRpcs = RpcGroup.make(Rpc.make("MemberGetId", { success: Schema.String })).middleware(
  ConnectionMiddleware,
);

class MemberShopActor extends Cloudflare.DurableObject<MemberShopActor, ShopActorShape>()(
  "MemberShopActor",
) {}

const MemberShopActorLive = MemberShopActor.make(
  ShopActorKit.make({
    rpcs: MemberRpcs,
    migrations: Migrator.fromRecord({ "0001_init": Effect.void }),
    caller: MemberCaller,
    build: ({ caller }) =>
      Effect.succeed({
        handlers: MemberRpcs.toLayer({
          MemberGetId: () => Effect.map(caller, ({ memberId }) => memberId),
        }),
      }),
  }),
);

ShopActorKit.make({
  rpcs: MemberRpcs,
  migrations: Migrator.fromRecord({ "0001_init": Effect.void }),
  build: () =>
    // @ts-expect-error the kit would decode this socket as a merchant
    Effect.succeed({
      handlers: MemberRpcs.toLayer({ MemberGetId: () => Effect.succeed("") }),
      sockets: {
        tags: (identity: SocketIdentity<typeof MemberCaller.Type>) => [identity.caller.memberId],
      },
    }),
});

// @ts-expect-error `getThing` is declared but not built
export const missingMethods: Effect.Effect<
  Effect.Effect<ShopActorShape<{ readonly getThing: () => Effect.Effect<string> }>, never, unknown>,
  never,
  unknown
> = ShopActorKit.make({
  rpcs: MemberRpcs,
  migrations: Migrator.fromRecord({ "0001_init": Effect.void }),
  caller: MemberCaller,
  build: () =>
    Effect.succeed({ handlers: MemberRpcs.toLayer({ MemberGetId: () => Effect.succeed("") }) }),
});

class ShopActorClient extends AtomRpc.Service<ShopActorClient>()("app/ShopActorClient", {
  group: CounterRpcs,
  protocol: shopActorProtocol({ allKeys: ["counter"] }),
}) {}

describe("the shop actor's pieces", () => {
  it("compose into an app's actor, its lifecycle calls, its upgrade and its client", () => {
    assert.isTrue(Layer.isLayer(ShopActorLive));
    assert.isTrue(Layer.isLayer(ShopActors.layer(ShopActor)));
    assert.isTrue(Effect.isEffect(actorUpgrade(ShopActor)));
    assert.isDefined(makeNoticesAtom(ShopActorClient.runtime));
  });

  it("serve an app whose caller is its own, behind its own gate", () => {
    assert.isTrue(Layer.isLayer(MemberShopActorLive));
    const gate = Effect.succeed(() => Effect.fail(404 as const));
    assert.isTrue(Effect.isEffect(actorUpgrade(MemberShopActor, { gate })));
    assert.strictEqual(refusalClose(404).code, CONNECTION_CLOSE_NOT_A_MEMBER);
  });
});
