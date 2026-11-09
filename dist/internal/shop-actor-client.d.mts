import { ShopDomain } from "./domain.mjs";
import { Notice, OwnNotice } from "./shop-actor-contract.mjs";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as PubSub from "effect/PubSub";
import * as RpcClient from "effect/rpc/RpcClient";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
/**
 * What {@link noticeBus} carries: the actor's notices, and `Connected`, which the socket publishes
 * itself on every (re)connect, naming every key, because a notice sent while this browser was
 * disconnected is lost.
 */
export type BusNotice = Notice | OwnNotice | {
  readonly _tag: "Connected";
  readonly invalidated: readonly string[];
};
/**
 * Notices pulled off the socket, and the socket's `Connected`; one per registry, like the socket.
 * The last one is replayed to a new subscriber: the first `Connected` is published while the
 * notices atom may still be subscribing, and dropping it would leave the server-rendered page
 * unchecked until the next write.
 */
export declare const noticeBus: Atom.Atom<PubSub.PubSub<BusNotice>>;
/**
 * The `protocol` of an app's `AtomRpc.Service` over its actor's procedures:
 *
 * ```ts
 * class ShopActorClient extends AtomRpc.Service<ShopActorClient>()("app/ShopActorClient", {
 *   group: AppRpcs,
 *   protocol: shopActorProtocol({ allKeys: ALL_KEYS }),
 * }) {}
 * ```
 *
 * It reads {@link shopKeyAtom}, `merchantTokenAtom` and `reconnectAtom`, so a change to any of
 * them rebuilds the client and reconnects. `allKeys` is every reactivity key the app's pages
 * read, which each connect names.
 */
export declare const shopActorProtocol: (options: {
  readonly allKeys: readonly string[];
}) => (get: Atom.AtomContext) => Layer.Layer<RpcClient.Protocol, never, never>;
/**
 * Names the shop and credential the protocol connects with, and starts the socket state afresh:
 * with `merchantToken`, a merchant's socket carrying a Shopify ID token minted per connect;
 * without, a socket the gate names from the session cookie. The key is cleared first and set
 * last, since a named key is what lets the protocol connect, so no socket dials with one shop's
 * key and another's credential. Only the socket holder runs it, once per shop and credential,
 * in the browser, before anything reads a socket atom.
 */
export declare const nameSocket: (registry: AtomRegistry.AtomRegistry, key: ShopDomain, merchantToken?: Effect.Effect<string>) => void;
/**
 * The default length of a notice key's window: the first notice for a key refreshes at once and
 * opens it; any more inside it cost one refresh when it ends, which opens the next. A burst of
 * writes then costs two reads of each shown page, not one per notice. A tab watching another
 * tab's writes may lag by up to the window; the tab that wrote never does, as its own notice is
 * not throttled.
 */
export declare const NOTICE_THROTTLE: Duration.Duration;
/** Notice keys to the routes that read them: the router's half of a live read. */
export interface LiveRoutes {
  readonly invalidate: (keys: ReadonlySet<string>) => void;
}
/** The browser router's {@link LiveRoutes}, set once by the app when it makes its router. */
export declare const liveRoutesAtom: Atom.Writable<LiveRoutes | undefined, LiveRoutes | undefined>;
/** Whether the tab is hidden, and a way to hear it change. The browser's is the document's. */
export interface Visibility {
  readonly isHidden: () => boolean;
  /** Calls `listener` on each change; answers the unsubscribe. */
  readonly onChange: (listener: () => void) => () => void;
}
/**
 * Each key is throttled over `throttle`, leading and trailing; while the tab is hidden its keys
 * are held, and released through the throttle when it is visible again, so a background tab reads
 * nothing. `Connected` is neither throttled nor held: it is rare, and whatever is shown may be
 * stale by however long the socket was down. An `OwnNotice` is not throttled or held either, and
 * it clears the read its keys owe: it comes after every notice before it, so its read covers
 * theirs. Windows that end together refresh together, so a route under two keys reruns once.
 */
export declare const makeNoticeDispatch: (refresh: (keys: ReadonlySet<string>) => void, options: {
  readonly throttle: Duration.Duration;
  readonly visibility: Visibility;
}) => {
  notice: (notice: BusNotice) => void;
  dispose: () => void;
};
/**
 * The atom that turns notices into reruns of the live routes they name, on the app's client
 * runtime: `makeNoticesAtom(ShopActorClient.runtime)`. The socket holder mounts it for as long as
 * the layout is, which is also what keeps the client's runtime, and so the socket, alive. Browser
 * only. It sees the last notice published before it subscribed, so every connect, the first
 * included, rereads what the page shows.
 */
export declare const makeNoticesAtom: <R, ER>(runtime: Atom.AtomRuntime<R, ER>, options?: {
  readonly throttle?: Duration.Input | undefined;
}) => Atom.Atom<import("effect/reactivity/AsyncResult").AsyncResult<BusNotice, ER | import("effect/Cause").NoSuchElementError>>;