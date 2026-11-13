import { ConnectionMiddleware, RequireMerchant } from "@mw10013/shopify-app-cloudflare/contract";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

export const COUNT_KEY = "count";

export const ALL_KEYS: readonly string[] = [COUNT_KEY];

export const CounterRpcs = RpcGroup.make(
  Rpc.make("MerchantGetCount", { success: Schema.Int }),
  Rpc.make("MerchantIncrement", { success: Schema.Int }),
)
  .middleware(RequireMerchant)
  .middleware(ConnectionMiddleware);
