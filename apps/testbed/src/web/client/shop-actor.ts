/**
 * The App Home's side of the shop actor: the RPC client over the package's socket protocol, the
 * notices atom, and the router's half of a live read. Step 8 part B moves the router glue into
 * the package.
 *
 * @module
 */

import {
  type LiveRoutes,
  makeNoticesAtom,
  shopActorProtocol,
} from "@mw10013/shopify-app-workers/client";
import type { AnyRouteMatch, AnyRouter } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as AtomRpc from "effect/reactivity/AtomRpc";

import { ALL_KEYS, CounterRpcs } from "#contract/counter.ts";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The notice keys whose writes may change this route's loader data. Absent: not live. */
    readonly live?: readonly string[];
  }
}

export class ShopActorClient extends AtomRpc.Service<ShopActorClient>()("app/ShopActorClient", {
  group: CounterRpcs,
  protocol: shopActorProtocol({ allKeys: ALL_KEYS }),
}) {}

/** Mounted by the socket holder for as long as the page is, which keeps the socket open. */
export const noticesAtom = makeNoticesAtom(ShopActorClient.runtime);

interface AppBridge {
  readonly idToken: () => Promise<string>;
}

/**
 * An ID token from App Bridge, minted for each connect: a browser cannot set a header on an
 * upgrade, and a token outlives no reconnect after a minute.
 */
export const mintIdToken: Effect.Effect<string> = Effect.promise(() =>
  (globalThis as typeof globalThis & { readonly shopify: AppBridge }).shopify.idToken(),
);

const readsAny = (match: AnyRouteMatch, keys: ReadonlySet<string>) =>
  (match.staticData.live ?? []).some((key) => keys.has(key));

/** Notice keys to `router.invalidate`, for the matches whose `staticData.live` names one. */
export const makeLiveRoutes = (router: AnyRouter): LiveRoutes => ({
  invalidate: (keys) => {
    if (router.state.matches.some((match) => readsAny(match, keys)))
      void router.invalidate({ filter: (match) => readsAny(match, keys) });
  },
});
