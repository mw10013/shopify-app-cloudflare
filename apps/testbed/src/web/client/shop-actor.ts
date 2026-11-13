import { makeNoticesAtom, shopActorProtocol } from "@mw10013/shopify-app-cloudflare/client";
import { makeLiveReads } from "@mw10013/shopify-app-cloudflare/website/react";
import * as AtomRpc from "effect/reactivity/AtomRpc";

import { ALL_KEYS, CounterRpcs } from "#contract/counter.ts";

export class ShopActorClient extends AtomRpc.Service<ShopActorClient>()("app/ShopActorClient", {
  group: CounterRpcs,
  protocol: shopActorProtocol({ allKeys: ALL_KEYS }),
}) {}

export const noticesAtom = makeNoticesAtom(ShopActorClient.runtime);

export const { readLiveAnswer } = makeLiveReads(ShopActorClient);
