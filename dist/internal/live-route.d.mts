import { LiveRoutes } from "./shop-actor-client.mjs";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import { AnyRouter } from "@tanstack/react-router";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The notice keys whose writes may change this route's loader data. Absent: not live. */
    readonly live?: readonly string[];
  }
}
/** The app's `AtomRpc.Service` client class over the shop actor's socket. */
export interface LiveClient<Self, Client, ER> extends Context.Key<Self, Client> {
  readonly runtime: Atom.AtomRuntime<Self, ER>;
}
/**
 * One live read over both transports: the server function, and the same actor procedure over the
 * socket. Both end in the same actor function, so the caller never sees which one ran.
 */
export interface LiveRead<Client, A> {
  readonly server: () => Promise<A>;
  readonly socket: (client: Client) => Effect.Effect<A, unknown>;
}
/**
 * `router.invalidate()` for a caller that wants the server's answer, not the socket's (a refused
 * socket): every live loader it reruns reads through the Backend. Not a loader's `cause`: the
 * router calls a match `stay` whenever the same route holds the same place in the tree, so a
 * filter or a page change is a `stay` too.
 */
export declare const reloadFromServer: (registry: AtomRegistry.AtomRegistry, router: {
  readonly invalidate: () => Promise<void>;
}) => Promise<void>;
/** True while `route` shows its last answer because a reread failed ({@link keepLastAnswer}). */
export declare const rereadFailedAtom: (arg: string) => Atom.Writable<boolean, boolean>;
/**
 * A live loader's answer, kept per route and request. When a read of the request the route last
 * answered fails without a refusal, the route keeps that answer and {@link rereadFailedAtom} says
 * so, instead of the error page replacing a page the merchant may be working in; the next notice
 * reads again. A refusal, a procedure's own failure, or a failed read of another request throws.
 */
export declare const keepLastAnswer: <A>(registry: AtomRegistry.AtomRegistry, at: {
  readonly route: string;
  readonly request: string;
}, read: (last: Option.Option<A>) => Promise<A>) => Promise<A>;
/**
 * The live reads over the app's actor client. `readLive` on the server calls the server function.
 * In the browser it reads over the actor socket while the socket is open, and over the server
 * function otherwise; it never waits for a socket, and neither read is ever interrupted.
 *
 * `readLiveAnswer` is for a loader whose server answer holds more than its socket read: the first
 * read of a request, and every `fresh` one, goes through the server function, and later ones read
 * the live part over the socket into the last answer ({@link keepLastAnswer}).
 *
 * `onServer` defaults to there being no `document`.
 */
export declare const makeLiveReads: <Self, Client, ER>(client: LiveClient<Self, Client, ER>, options?: {
  readonly onServer?: boolean;
}) => {
  readLive: <A>(registry: AtomRegistry.AtomRegistry, read: LiveRead<Client, A>) => Promise<A>;
  readLiveAnswer: <A>(registry: AtomRegistry.AtomRegistry, read: {
    readonly route: string;
    readonly request: string;
    readonly fresh?: boolean;
    readonly server: () => Promise<A>;
    readonly socket: (client: Client, last: A) => Effect.Effect<A, unknown>;
  }) => Promise<A>;
};
/** A live route's `staleTime`: never stale by age, only when a notice names its keys. */
export declare const STALE_ON_NOTICE_ONLY: number;
/**
 * Reruns `routeId`'s loader now, resolving once its new data is in: for a write whose page must
 * show its result before it moves on.
 */
export declare const rereadRoute: (router: AnyRouter, routeId: string) => Promise<void>;
/**
 * Notice keys to `router.invalidate`, for the routes that declare them; the app sets it as
 * `liveRoutesAtom` in the browser's registry. It never invalidates while the router is loading:
 * `invalidate` would detach that load's reads, which still run at the actor, and pay for them
 * twice. The keys are owed instead and replayed once that load resolves. A call no live match
 * reads starts no load.
 */
export declare const makeLiveRoutes: (router: AnyRouter) => LiveRoutes;