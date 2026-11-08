import * as Test from "@alchemy.run/test/Vitest";
import { SHOPIFY_TEST_DOOR_PATH, ShopifyTestDoorRpcs } from "@mw10013/shopify-app-workers/test";
import * as Effect from "effect/Effect";
import * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcClientError from "effect/rpc/RpcClientError";

/** One call through the test Backend's {@link ShopifyTestDoorRpcs}. */
export const door = <A, E>(
  backendUrl: string,
  f: (
    client: RpcClient.FromGroup<typeof ShopifyTestDoorRpcs, RpcClientError.RpcClientError>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* f(yield* RpcClient.make(ShopifyTestDoorRpcs));
  }).pipe(
    Effect.scoped,
    Effect.provide(Test.rpcClientLayer(new URL(SHOPIFY_TEST_DOOR_PATH, backendUrl).href)),
  );
