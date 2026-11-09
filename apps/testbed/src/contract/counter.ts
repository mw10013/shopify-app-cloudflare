/**
 * The testbed's shop actor procedures and its one reactivity key, shared by the Backend and the
 * browser: a per-shop counter that proves the package's actor kit and browser client end to end.
 *
 * @module
 */

import { ConnectionMiddleware, RequireMerchant } from "@mw10013/shopify-app-workers/contract";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

/** The key a notice names after the count changes; the App Home's loader reads under it. */
export const COUNT_KEY = "count";

/** Every key the testbed's pages read, which each connect names. */
export const ALL_KEYS: readonly string[] = [COUNT_KEY];

/** `MerchantIncrement` answers the count after its write. */
export const CounterRpcs = RpcGroup.make(
  Rpc.make("MerchantGetCount", { success: Schema.Int }),
  Rpc.make("MerchantIncrement", { success: Schema.Int }),
)
  .middleware(RequireMerchant)
  .middleware(ConnectionMiddleware);
