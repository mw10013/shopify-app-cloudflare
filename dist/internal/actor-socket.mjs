import { CONNECTION_CLOSE_FORBIDDEN } from "./shop-actor-contract.mjs";
import { layerStrictJson } from "./strict-serialization.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as RpcWebSocket from "@alchemy.run/cloudflare/Workers/RpcWebSocket";
import { RuntimeContext } from "alchemy";
import * as HttpBody from "effect/http/HttpBody";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Scope from "effect/Scope";
// src/internal/actor-socket.ts
/**
* Effect RPC on a Durable Object's hibernating sockets, with the caller fixed when the socket is
* accepted.
*
* @module
*/
/**
* A socket's attachment as the actor reads it: only its own `shopActor` key. Alchemy's transport
* keeps its record beside it under its own key and rewrites it by spreading the previous
* attachment, so `shopActor` survives those writes and a hibernation.
*/
const attachment = (caller) => Schema.Struct({ shopActor: Schema.optional(Schema.Struct({
	caller,
	connectedAt: Schema.DateTimeUtcFromMillis
})) });
/**
* The identity of the socket whose message is being dispatched, provided around the transport's
* dispatch. The RPC server runs each call with the dispatching fiber's context, so a middleware
* reads it there; it is absent everywhere else.
*/
var ConnectionIdentity = class extends Context.Service()("app/ConnectionIdentity") {};
/**
* The socket whose message is being dispatched, provided beside {@link ConnectionIdentity}: a
* write's notice goes to it as its own (`OwnNotice`). Absent outside a socket's dispatch, as in a
* webhook's call or the actor's alarm.
*/
var DispatchingSocket = class extends Context.Service()("app/DispatchingSocket") {};
/**
* The identity a socket being accepted gets, its tags, and where the accepted socket is
* recorded. Present only inside {@link make}'s `fetch`, the only place a socket is accepted.
*/
var PendingAccept = class extends Context.Service()("app/PendingAccept") {};
/** Keeps the object alive until each call's fiber ends; Alchemy's `RpcDurableObject` does the same. */
var RequestLifetime = class extends RpcMiddleware.Service()("app/RequestLifetime") {};
/** Reason sent with {@link CONNECTION_CLOSE_FORBIDDEN} to a socket with no identity. */
const UNIDENTIFIED_REASON = "unidentified connection";
/**
* Effect RPC on a Durable Object's hibernating sockets, with the caller's identity fixed at
* accept. Alchemy's `RpcDurableObject` accepts the socket before any of the object's code sees
* the upgrade, and cannot host schemaless methods beside its RPC; this reuses its internal
* transport and adds the identity at accept and on each message.
*
* - `fetch(identity)` accepts the upgrade in hand: the identity goes into the socket's
*   attachment, and `tags(identity)` onto the socket, before the RPC transport records it.
* - `webSocketMessage` reads the identity back from the attachment (cached per activation), hands
*   it to `beforeDispatch`, which may close the socket and decline, and dispatches with
*   {@link ConnectionIdentity} and {@link DispatchingSocket} provided. A socket with no identity
*   is closed with {@link CONNECTION_CLOSE_FORBIDDEN}.
*
* Payloads are decoded by {@link layerStrictJson}. Built once per activation, in the object's
* inner Effect.
*
* @see `@alchemy.run/cloudflare/src/Workers/RpcWebSocket.ts` `make`
* @see `@alchemy.run/cloudflare/src/Workers/RpcDurableObject.ts` `makeHandlers`
*/
const make = Effect.fn("ActorSocket.make")(function* (options) {
	const Attachment = attachment(options.caller);
	const encodeAttachment = Schema.encodeSync(Attachment);
	const decodeAttachment = Schema.decodeUnknownOption(Attachment);
	const state = yield* Cloudflare.DurableObjectState;
	const runtime = yield* RuntimeContext;
	const decorated = {
		...state,
		acceptWebSocket: (ws, tags) => Effect.gen(function* () {
			const pending = yield* Effect.serviceOption(PendingAccept);
			if (Option.isNone(pending)) return yield* Effect.die(/* @__PURE__ */ new Error("a socket was accepted outside ActorSocket.fetch"));
			yield* state.acceptWebSocket(ws, [...tags ?? [], ...pending.value.tags]);
			ws.serializeAttachment({
				...ws.deserializeAttachment(),
				shopActor: pending.value.encoded
			});
			pending.value.accepted = Option.some(ws);
		})
	};
	return yield* Effect.acquireUseRelease(Scope.make(), (instanceScope) => Effect.gen(function* () {
		const memoMap = Layer.makeMemoMapUnsafe();
		const context = yield* Layer.buildWithMemoMap(options.handlers, memoMap, instanceScope);
		const lifetime = Layer.succeed(RequestLifetime, (effect) => Effect.withFiber((fiber) => state.waitUntil(Fiber.await(fiber)).pipe(Effect.provideService(RuntimeContext, runtime), Effect.andThen(effect))));
		const transport = yield* RpcWebSocket.make.pipe(Effect.provideService(Cloudflare.DurableObjectState, decorated), Effect.provide(layerStrictJson));
		const server = RpcServer.layer(options.group.middleware(RequestLifetime)).pipe(Layer.provide(Layer.mergeAll(Layer.succeedContext(context), lifetime, Layer.succeed(RpcServer.Protocol, transport.protocol))));
		yield* Layer.buildWithMemoMap(server, memoMap, instanceScope);
		/** Identities by raw socket, for this activation only; rebuilt from attachments after a wake. */
		const identities = /* @__PURE__ */ new WeakMap();
		const identityOf = (socket) => Effect.sync(() => {
			const cached = identities.get(socket.ws);
			if (cached !== void 0) return Option.some(cached);
			const identity = Option.flatMap(decodeAttachment(socket.deserializeAttachment()), ({ shopActor }) => Option.fromUndefinedOr(shopActor));
			if (Option.isSome(identity)) identities.set(socket.ws, identity.value);
			return identity;
		});
		const fetch = (identity) => Effect.gen(function* () {
			const pending = PendingAccept.of({
				encoded: encodeAttachment({ shopActor: identity }).shopActor,
				tags: options.tags?.(identity) ?? [],
				accepted: Option.none()
			});
			return {
				response: yield* transport.fetch.pipe(Effect.provideService(PendingAccept, pending)),
				socket: pending.accepted
			};
		});
		const webSocketMessage = (socket, message) => Effect.gen(function* () {
			const identity = yield* identityOf(socket);
			if (Option.isNone(identity)) return yield* socket.close(CONNECTION_CLOSE_FORBIDDEN, UNIDENTIFIED_REASON);
			if (options.beforeDispatch !== void 0 && !(yield* options.beforeDispatch(identity.value, socket))) return;
			yield* transport.webSocketMessage(socket, message).pipe(Effect.provideService(ConnectionIdentity, identity.value), Effect.provideService(DispatchingSocket, socket));
		});
		return {
			fetch,
			webSocketMessage,
			identityOf,
			webSocketClose: (socket) => Effect.sync(() => identities.delete(socket.ws)).pipe(Effect.andThen(transport.webSocketClose(socket))),
			webSocketError: (socket, error) => Effect.sync(() => identities.delete(socket.ws)).pipe(Effect.andThen(transport.webSocketError(socket, error)))
		};
	}), (instanceScope, exit) => Exit.isFailure(exit) ? Scope.close(instanceScope, exit) : Effect.void);
});
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
const refusedUpgrade = (code, reason) => Effect.sync(() => {
	const { WebSocketPair, Response } = globalThis;
	const pair = new WebSocketPair();
	setTimeout(() => {
		pair[1].accept();
		pair[1].close(code, reason);
	}, 0);
	return HttpServerResponse.setBody(HttpServerResponse.empty({ status: 101 }), HttpBody.raw(new Response(null, {
		status: 101,
		webSocket: pair[0]
	})));
});
export { ConnectionIdentity, DispatchingSocket, attachment, make, refusedUpgrade };
