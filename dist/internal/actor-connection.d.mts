import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Atom from "effect/reactivity/Atom";
import * as Socket from "effect/socket/Socket";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
/**
 * The shop whose actor this registry's client talks to; None until the socket holder names it
 * (`nameSocket`), which it does before the page reads any socket atom. This and the other plain
 * state atoms here are kept alive: they are set while nothing on the page reads them yet, and an
 * unread atom would drop the value.
 */
export declare const shopKeyAtom: Atom.Writable<Option.Option<string & import("effect/Brand").Brand<"ShopDomain">>, Option.Option<string & import("effect/Brand").Brand<"ShopDomain">>>;
/**
 * How the merchant's browser gets a Shopify ID token, run once per connect, so every reconnect
 * carries a token minted for it. None for a socket the gate names from the session cookie, and
 * until the socket holder names the socket.
 */
export declare const merchantTokenAtom: Atom.Writable<Option.Option<Effect.Effect<string, never, never>>, Option.Option<Effect.Effect<string, never, never>>>;
/** Bumped by each stop ({@link CloseOutcome}): the page asks the router again. */
export declare const reaskAtom: Atom.Writable<number, number>;
/**
 * The actor socket as the page shows it. A stop, with its close code, is terminal: the socket
 * stays closed until the merchant asks again ({@link reconnectAtom}).
 */
export type SocketState = "connecting" | "open" | "lost" | {
  readonly stopped: number;
};
export declare const socketStateAtom: Atom.Writable<SocketState, SocketState>;
/** Bumped by the banner's Reconnect; the protocol reads it, so a bump rebuilds it. */
export declare const reconnectAtom: Atom.Writable<number, number>;
/** True once {@link socketStateAtom} has been `lost` for {@link LOST_GRACE}. */
export declare const lostAtom: Atom.Atom<boolean>;
/**
 * What a close means for the socket, one of two:
 *
 * - `Retry`: every close outside 44xx, such as a revoke's 3401 after a plan change, the gate's
 *   1013 or a dropped connection. The reconnect goes back through the gate, which gives the
 *   current answer: after a lapse, 4402. A 3401 also asks the router again (`reask`), since
 *   the revoke means what the page was given, such as the plan, has changed.
 * - `Stop`: every 44xx, the gate's refusals (4402 a lapsed plan among them) and the actor's
 *   uninstall. Asking the socket again would get the same answer, so it stays closed and the
 *   page asks the router instead.
 */
export type CloseOutcome = {
  readonly _tag: "Retry";
  readonly reask: boolean;
} | {
  readonly _tag: "Stop";
  readonly code: number;
};
export declare const closeOutcome: (error: Socket.SocketError) => CloseOutcome;
/**
 * The socket's retry policy: exponential from 250 ms, capped at 4 s, until a stop
 * ({@link CloseOutcome}). Every error the policy sees goes to `onError` first, which is how the
 * page learns the close code.
 */
export declare const retryPolicy: (onError: (error: Socket.SocketError) => Effect.Effect<void>) => Schedule.Schedule<Duration.Duration, Socket.SocketError, never, never>;
export declare const applyCloseOutcome: (registry: AtomRegistry.AtomRegistry, outcome: CloseOutcome) => Effect.Effect<void>;