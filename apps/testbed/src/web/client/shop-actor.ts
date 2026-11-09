/**
 * The App Home's side of the shop actor: the RPC client over the package's socket protocol, the
 * notices atom the socket holder mounts, and the live reads over this client.
 *
 * @module
 */

import { makeNoticesAtom, shopActorProtocol } from "@mw10013/shopify-app-workers/client";
import { makeLiveReads } from "@mw10013/shopify-app-workers/website/react";
import * as AtomRpc from "effect/reactivity/AtomRpc";

import { ALL_KEYS, CounterRpcs } from "#contract/counter.ts";

export class ShopActorClient extends AtomRpc.Service<ShopActorClient>()("app/ShopActorClient", {
  group: CounterRpcs,
  protocol: shopActorProtocol({ allKeys: ALL_KEYS }),
}) {}

/** Mounted by the socket holder for as long as the page is, which keeps the socket open. */
export const noticesAtom = makeNoticesAtom(ShopActorClient.runtime);

export const { readLiveAnswer } = makeLiveReads(ShopActorClient);
