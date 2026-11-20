import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Migrator from "@effect/sql-sqlite-do/SqliteMigrator";
import { assert, describe, it, vi } from "@effect/vitest";
import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { ShopActorKit } from "#internal/shop-actor-kit.ts";
import { AppInstallations } from "#internal/shopify-access.ts";

import { capturingLogs, type Logged } from "./logs.ts";

const SHOP = "a.myshopify.com";

const nativeState = () => {
  const sqlite = new DatabaseSync(":memory:");
  const exec = (query: string, ...bindings: SQLInputValue[]) => {
    const statement = sqlite.prepare(query);
    const columnNames = statement.columns().map(({ name }) => name);
    statement.setReturnArrays(true);
    const rows = statement.all(...bindings) as unknown as unknown[][];
    return {
      columnNames,
      raw: () => rows.values(),
      toArray: () =>
        rows.map((row) => Object.fromEntries(columnNames.map((name, i) => [name, row[i]]))),
    };
  };
  return {
    id: { name: SHOP, toString: () => SHOP },
    storage: {
      sql: { exec },
      transaction: (body: (txn: { rollback: () => void }) => Promise<void>) =>
        body({ rollback: () => undefined }),
    },
    getWebSockets: () => [],
    getWebSocketAutoResponse: () => null,
    setWebSocketAutoResponse: () => undefined,
  } as unknown as Cloudflare.NativeDurableObjectState;
};

// workerd's global, which Alchemy's socket transport builds its heartbeat with.
vi.stubGlobal(
  "WebSocketRequestResponsePair",
  function (this: { request: string; response: string }, request: string, response: string) {
    this.request = request;
    this.response = response;
  },
);

const NoRpcs = RpcGroup.make(Rpc.make("Ping"));

interface LoggingMethods {
  readonly logThroughRuntime: () => Effect.Effect<void>;
}

const kit = ShopActorKit.make({
  rpcs: NoRpcs,
  migrations: Migrator.fromRecord({ "0001_init": Effect.void }),
  build: ({ runtime }) =>
    Effect.succeed({
      handlers: NoRpcs.toLayer({ Ping: () => Effect.void }),
      methods: {
        logThroughRuntime: () => Effect.logInfo("logThroughRuntime").pipe(Effect.provide(runtime)),
      } satisfies LoggingMethods,
      alarm: () => Effect.logInfo("alarm"),
    }),
});

const installed = Layer.succeed(AppInstallations)({
  find: () => Effect.succeed(Option.some({} as never)),
  shops: Effect.succeed([]),
  page: () => Effect.die("unused"),
} as unknown as AppInstallations["Service"]);

describe("a shop actor's stub methods", () => {
  it.effect("log through the loggers of the call, not those of the activation", () =>
    Effect.gen(function* () {
      const activation: Logged[] = [];
      const event: Logged[] = [];
      const actor = yield* kit.pipe(
        Effect.flatten,
        Effect.provide(installed),
        Effect.provideService(
          Cloudflare.DurableObjectState,
          Cloudflare.fromDurableObjectState(nativeState()),
        ),
        Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]),
        capturingLogs(activation),
      );
      const shape = actor as unknown as LoggingMethods & {
        readonly revoke: () => Effect.Effect<unknown>;
        readonly alarm: () => Effect.Effect<void>;
      };
      const activated = activation.length;
      yield* Effect.all([shape.logThroughRuntime(), shape.revoke(), shape.alarm()]).pipe(
        capturingLogs(event),
      );
      assert.deepStrictEqual(
        event.map(({ message }) => message),
        ["logThroughRuntime", `ShopActor.revoke: shop=${SHOP} closed=0`, "alarm"],
      );
      assert.strictEqual(activation.length, activated);
    }).pipe(Effect.scoped),
  );
});
