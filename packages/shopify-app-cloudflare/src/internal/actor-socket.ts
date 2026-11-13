import * as Cloudflare from "@alchemy.run/cloudflare";
import * as RpcWebSocket from "@alchemy.run/cloudflare/Workers/RpcWebSocket";
import type * as Workers from "@cloudflare/workers-types";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { type Caller, CONNECTION_CLOSE_FORBIDDEN } from "./shop-actor-contract.ts";
import { layerStrictJson } from "./strict-serialization.ts";

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

/**
 * A socket's attachment as the actor reads it: only its own `shopActor` key. Alchemy's transport
 * keeps its record beside it under its own key and rewrites it by spreading the previous
 * attachment, so `shopActor` survives those writes and a hibernation.
 */
export const attachment = <C extends Caller>(caller: CallerSchema<C>) =>
  Schema.Struct({
    shopActor: Schema.optional(
      Schema.Struct({ caller, connectedAt: Schema.DateTimeUtcFromMillis }),
    ),
  });

/**
 * The identity of the socket whose message is being dispatched, provided around the transport's
 * dispatch. The RPC server runs each call with the dispatching fiber's context, so a middleware
 * reads it there; it is absent everywhere else.
 */
export class ConnectionIdentity extends Context.Service<ConnectionIdentity, SocketIdentity>()(
  "app/ConnectionIdentity",
) {}

/**
 * The socket whose message is being dispatched, provided beside {@link ConnectionIdentity}: a
 * write's notice goes to it as its own (`OwnNotice`). Absent outside a socket's dispatch, as in a
 * webhook's call or the actor's alarm.
 */
export class DispatchingSocket extends Context.Service<
  DispatchingSocket,
  Cloudflare.Workers.WebSocket
>()("app/DispatchingSocket") {}

class PendingAccept extends Context.Service<
  PendingAccept,
  {
    readonly encoded: unknown;
    readonly tags: readonly string[];
    accepted: Option.Option<Cloudflare.Workers.WebSocket>;
  }
>()("app/PendingAccept") {}

class KeepAliveUntilCallEnds extends RpcMiddleware.Service<KeepAliveUntilCallEnds>()(
  "app/RequestLifetime",
) {}

export const UNIDENTIFIED_REASON = "unidentified connection";

/**
 * Effect RPC on a Durable Object's hibernating sockets, with the caller's identity fixed at
 * accept. Alchemy's `RpcDurableObject` accepts the socket before any of the object's code sees
 * the upgrade, and cannot host schemaless methods beside its RPC; this reuses its internal
 * transport and adds the identity at accept and on each message.
 *
 * @see `@alchemy.run/cloudflare/src/Workers/RpcWebSocket.ts` `make`
 * @see `@alchemy.run/cloudflare/src/Workers/RpcDurableObject.ts` `makeHandlers`
 */
export const make = Effect.fn("ActorSocket.make")(function* <
  Rpcs extends Rpc.Any,
  RH,
  C extends Caller,
>(options: {
  readonly group: RpcGroup.RpcGroup<Rpcs>;
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>, never, RH>;
  readonly caller: CallerSchema<C>;
  readonly tags?: ((identity: SocketIdentity<C>) => readonly string[]) | undefined;
  readonly beforeDispatch?:
    | ((
        identity: SocketIdentity<C>,
        socket: Cloudflare.Workers.WebSocket,
      ) => Effect.Effect<boolean>)
    | undefined;
}) {
  const Attachment = attachment(options.caller);
  const encodeAttachment = Schema.encodeSync(Attachment);
  const decodeAttachment = Schema.decodeUnknownOption(Attachment);
  const state = yield* Cloudflare.DurableObjectState;
  const runtime = yield* RuntimeContext;
  const decorated: Cloudflare.DurableObjectState["Service"] = {
    ...state,
    acceptWebSocket: (ws, tags) =>
      Effect.gen(function* () {
        const pending = yield* Effect.serviceOption(PendingAccept);
        if (Option.isNone(pending))
          return yield* Effect.die(new Error("a socket was accepted outside ActorSocket.fetch"));
        yield* state.acceptWebSocket(ws, [...(tags ?? []), ...pending.value.tags]);
        ws.serializeAttachment({
          ...ws.deserializeAttachment<object>(),
          shopActor: pending.value.encoded,
        });
        pending.value.accepted = Option.some(ws);
      }),
  };

  return yield* Effect.acquireUseRelease(
    Scope.make(),
    (instanceScope) =>
      Effect.gen(function* () {
        const memoMap = Layer.makeMemoMapUnsafe();
        const context = yield* Layer.buildWithMemoMap(options.handlers, memoMap, instanceScope);
        const lifetime = Layer.succeed(KeepAliveUntilCallEnds, (effect) =>
          Effect.withFiber((fiber) =>
            // RpcServer sends Exit before finalization and drops sends after disconnect.
            state
              .waitUntil(Fiber.await(fiber))
              .pipe(Effect.provideService(RuntimeContext, runtime), Effect.andThen(effect)),
          ),
        );
        const transport = yield* RpcWebSocket.make.pipe(
          Effect.provideService(Cloudflare.DurableObjectState, decorated),
          Effect.provide(layerStrictJson),
        );
        // `context` holds every handler and middleware of `Rpcs`; TypeScript cannot subtract them
        // from the server's requirements for a generic `Rpcs`.
        const server = RpcServer.layer(options.group.middleware(KeepAliveUntilCallEnds)).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeedContext(context),
              lifetime,
              Layer.succeed(RpcServer.Protocol, transport.protocol),
            ),
          ),
        ) as Layer.Layer<never>;
        yield* Layer.buildWithMemoMap(server, memoMap, instanceScope);

        /** Identities by raw socket, for this activation only; rebuilt from attachments after a wake. */
        const identities = new WeakMap<Cloudflare.Workers.RawWebSocket, SocketIdentity<C>>();
        const identityOf = (socket: Cloudflare.Workers.WebSocket) =>
          Effect.sync(() => {
            const cached = identities.get(socket.ws);
            if (cached !== undefined) return Option.some(cached);
            const identity = Option.flatMap(
              decodeAttachment(socket.deserializeAttachment<unknown>()),
              ({ shopActor }) => Option.fromUndefinedOr(shopActor),
            );
            if (Option.isSome(identity)) identities.set(socket.ws, identity.value);
            return identity;
          });

        const fetch = (identity: SocketIdentity<C>) =>
          Effect.gen(function* () {
            const pending = PendingAccept.of({
              encoded: encodeAttachment({ shopActor: identity }).shopActor,
              tags: options.tags?.(identity) ?? [],
              accepted: Option.none(),
            });
            const response = yield* transport.fetch.pipe(
              Effect.provideService(PendingAccept, pending),
            );
            return { response, socket: pending.accepted };
          });

        const webSocketMessage = (
          socket: Cloudflare.Workers.WebSocket,
          message: string | ArrayBuffer,
        ) =>
          Effect.gen(function* () {
            const identity = yield* identityOf(socket);
            if (Option.isNone(identity))
              return yield* socket.close(CONNECTION_CLOSE_FORBIDDEN, UNIDENTIFIED_REASON);
            if (
              options.beforeDispatch !== undefined &&
              !(yield* options.beforeDispatch(identity.value, socket))
            )
              return;
            yield* transport
              .webSocketMessage(socket, message)
              .pipe(
                Effect.provideService(ConnectionIdentity, identity.value),
                Effect.provideService(DispatchingSocket, socket),
              );
          });

        return {
          fetch,
          webSocketMessage,
          identityOf,
          webSocketClose: (socket: Cloudflare.Workers.WebSocket) =>
            Effect.sync(() => identities.delete(socket.ws)).pipe(
              Effect.andThen(transport.webSocketClose(socket)),
            ),
          webSocketError: (socket: Cloudflare.Workers.WebSocket, error: unknown) =>
            Effect.sync(() => identities.delete(socket.ws)).pipe(
              Effect.andThen(transport.webSocketError(socket, error)),
            ),
        };
      }),
    (instanceScope, exit) =>
      Exit.isFailure(exit) ? Scope.close(instanceScope, exit) : Effect.void,
  );
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
export const refusedUpgrade = (code: number, reason: string) =>
  Effect.sync(() => {
    const { WebSocketPair, Response } = globalThis as unknown as {
      readonly WebSocketPair: typeof Workers.WebSocketPair;
      readonly Response: typeof Workers.Response;
    };
    const pair = new WebSocketPair();
    setTimeout(() => {
      pair[1].accept();
      pair[1].close(code, reason);
    }, 0);
    return HttpServerResponse.setBody(
      HttpServerResponse.empty({ status: 101 }),
      HttpBody.raw(new Response(null, { status: 101, webSocket: pair[0] })),
    );
  });
