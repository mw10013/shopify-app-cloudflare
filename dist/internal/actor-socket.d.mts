import { Caller } from "./shop-actor-contract.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import "effect/Option";
import * as Effect from "effect/Effect";
import "effect/Layer";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { RuntimeContext } from "alchemy";
import "effect/http/HttpBody";
import "effect/Scope";
import "effect/rpc/Rpc";
import "effect/rpc/RpcGroup";
/**
 * Who is on a socket, written into its attachment when the socket is accepted: the caller the
 * Backend's gate resolved, and when the socket was accepted, which tells apart two sockets of one
 * caller in a log and orders a member's sockets for displacement.
 */
export interface SocketIdentity<C extends Caller = Caller> {
  readonly caller: C;
  readonly connectedAt: DateTime.Utc;
}
/** The schema of an app's callers: what `CONNECTION_HEADER` carries, as JSON. */
export type CallerSchema<C extends Caller> = Schema.Codec<C, unknown>;
declare const ConnectionIdentity_base: Context.ServiceClass<ConnectionIdentity, "app/ConnectionIdentity", SocketIdentity<Caller>>;
/**
 * The identity of the socket whose message is being dispatched, provided around the transport's
 * dispatch. The RPC server runs each call with the dispatching fiber's context, so a middleware
 * reads it there; it is absent everywhere else.
 */
export declare class ConnectionIdentity extends ConnectionIdentity_base {}
declare const DispatchingSocket_base: Context.ServiceClass<DispatchingSocket, "app/DispatchingSocket", Cloudflare.WebSocket>;
/**
 * The socket whose message is being dispatched, provided beside {@link ConnectionIdentity}: a
 * write's notice goes to it as its own (`OwnNotice`). Absent outside a socket's dispatch, as in a
 * webhook's call or the actor's alarm.
 */
export declare class DispatchingSocket extends DispatchingSocket_base {}
/**
 * A `101` whose socket closes at once with `code`: how an upgrade is refused, because a refused
 * handshake reaches a browser's `WebSocket` only as a bare 1006 with no status, and the Website's
 * dev server drops it altogether.
 *
 * The server end is accepted and closed a turn after the `101` is returned, never before. Accepted
 * before, its read loop is already waiting when the runtime starts pumping the returned end, the
 * pump takes a path that fails once the close handshake ends, and the runtime logs the request as
 * an uncaught `Network connection lost.` that no code here can catch. The order is workerd's
 * behaviour, not its API.
 *
 * @see https://github.com/iterate/iterate/pull/3174
 */
export declare const refusedUpgrade: (code: number, reason: string) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, never>;
export {};