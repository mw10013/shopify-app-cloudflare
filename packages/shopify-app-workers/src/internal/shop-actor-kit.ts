/**
 * `ShopActorKit`: the body of an app's shop actor, one Durable Object per shop named by its
 * `ShopDomain`. The app declares the class and its procedures; the kit owns the lifecycle every
 * app writes the same way.
 *
 * @module
 */

import * as Cloudflare from "@alchemy.run/cloudflare";
import type * as Workers from "@cloudflare/workers-types";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import type { RuntimeContext } from "alchemy";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import * as ActorSocket from "./actor-socket.ts";
import { crossDefects, logDefect } from "./defects.ts";
import { ShopDomain } from "./domain.ts";
import {
  type Caller,
  CONNECTION_CLOSE_FORBIDDEN,
  CONNECTION_CLOSE_REVOKED,
  CONNECTION_CLOSE_UNINSTALLED,
  CONNECTION_HEADER,
  ConnectionMiddleware,
  CurrentCaller,
  ForbiddenError,
  MerchantCaller,
  NoticeFrame,
  RequireMerchant,
} from "./shop-actor-contract.ts";
import { AppInstallations } from "./shopify-access.ts";
import { syncTransaction, type Transaction } from "./transaction.ts";

/**
 * The reason `destroy` aborts the object with. The stub call it lands in rejects with an `Error`
 * of this message, which is how `ShopActors.destroy` tells the abort from a failure.
 */
export const ABORT_UNINSTALLED = "uninstalled";

/**
 * What the actor's first activation dies with when the shop has no `AppInstallation`. It writes
 * nothing, so `ShopActors.destroy` reads it as a store already empty: a shop whose actor never
 * started, or a repeated uninstall. It dies inside the object's constructor, so the stub call
 * rejects with it as a plain `Error` that keeps its own fields, `_tag` among them (measured in
 * workerd 1.20261026.1, baton#75). `shop` is the object's name, or its id when it has none.
 */
export class ShopNotInstalledError extends Schema.TaggedError<ShopNotInstalledError>()(
  "ShopNotInstalledError",
  { shop: Schema.String },
) {
  override get message() {
    return `ShopActor.activate: shop=${this.shop}: no AppInstallation, not created`;
  }
}

/** The stub methods the kit serves on every shop actor, beside the app's own. */
export interface ShopActorLifecycle {
  /** Uninstall: closes every socket, deletes the alarm and all storage, and aborts the object. */
  readonly destroy: () => Effect.Effect<void>;
  /** A plan change: closes every open socket so each reconnect meets the gate again. */
  readonly revoke: () => Effect.Effect<{ readonly closed: number }>;
}

/**
 * The shape an app declares its `ShopActor` class with: the kit's {@link ShopActorLifecycle} and
 * the app's own stub methods, which only the Backend can call.
 *
 * A value that carries an instant crosses as its schema's `Encoded` form: the stub is Workers RPC,
 * which refuses an object with a prototype of its own, and a `DateTime.Utc` is one.
 */
export type ShopActorShape<Methods extends StubMethods<Methods> = object> = ShopActorLifecycle &
  Methods;

/** An app's own stub methods: each answers an Effect, as Workers RPC on the stub requires. */
export type StubMethods<Methods> = {
  readonly [K in keyof Methods]: (...args: never) => Effect.Effect<unknown>;
};

/** What an app's `build` gets, once per activation of a named, installed shop's actor. */
export interface ShopActorContext<C extends Caller = MerchantCaller> {
  readonly shop: ShopDomain;
  /** The caller of the procedure being served, as the kit's `caller` schema decoded it. */
  readonly caller: Effect.Effect<C, never, CurrentCaller>;
  /** The object's own SQLite, migrated. */
  readonly sql: SqlClient.SqlClient;
  /** A multi-statement body in one storage transaction; see {@link Transaction}. */
  readonly transaction: Transaction;
  /**
   * Pushes `invalidated` to every socket: the socket whose message is being served gets it as its
   * own notice (`OwnNotice`), the others as the plain one. Never fails.
   */
  readonly notify: (invalidated: readonly string[]) => Effect.Effect<void>;
  /** The object's state: its storage, its alarm and its sockets. */
  readonly state: Cloudflare.DurableObjectState["Service"];
  /** The activation's runtime, which a stub method or the alarm provides to reach `state`. */
  readonly runtime: Context.Context<RuntimeContext>;
  /** Closes a socket; a close that throws is logged and never fails the caller. */
  readonly closeSocket: (
    socket: Cloudflare.Workers.WebSocket,
    code: number,
    reason: string,
  ) => Effect.Effect<void>;
}

/**
 * The socket hooks an app with more than one socket per caller sets: baton's displacement, which
 * tags each member's socket and closes the oldest with `CONNECTION_CLOSE_DISPLACED`.
 */
export interface ShopActorSocketHooks<C extends Caller> {
  /** Tags written onto a socket when it is accepted, which `state.getWebSockets(tag)` reads. */
  readonly tags?: ((identity: ActorSocket.SocketIdentity<C>) => readonly string[]) | undefined;
  /** Runs after a socket is accepted, with the accepted socket. */
  readonly onAccept?:
    | ((
        identity: ActorSocket.SocketIdentity<C>,
        socket: Cloudflare.Workers.WebSocket,
      ) => Effect.Effect<void>)
    | undefined;
  /** Runs before each message is dispatched; false declines it (the hook closes the socket). */
  readonly beforeDispatch?:
    | ((
        identity: ActorSocket.SocketIdentity<C>,
        socket: Cloudflare.Workers.WebSocket,
      ) => Effect.Effect<boolean>)
    | undefined;
}

/** The middleware the kit provides itself. */
type KitMiddleware = ConnectionMiddleware | RequireMerchant;

/** What an app's `build` answers. */
export interface ShopActorBuild<
  Rpcs extends Rpc.Any,
  C extends Caller,
  Methods extends StubMethods<Methods>,
> {
  /** The app's procedure handlers, and any middleware of its own beyond the kit's. */
  readonly handlers: Layer.Layer<
    Rpc.ToHandler<Rpcs> | Exclude<Rpc.Middleware<Rpcs>, KitMiddleware>
  >;
  /** The app's stub methods, served beside {@link ShopActorLifecycle}. */
  readonly methods?: Methods | undefined;
  /** The actor's alarm. */
  readonly alarm?: (() => Effect.Effect<void>) | undefined;
  readonly sockets?: ShopActorSocketHooks<C> | undefined;
}

/** The services the object provides to its activation. */
type ActivationServices = RuntimeContext | Cloudflare.DurableObjectState | Scope.Scope;

export interface ShopActorKitOptions<
  Rpcs extends Rpc.Any,
  C extends Caller,
  Methods extends StubMethods<Methods>,
  R,
> {
  /** The app's procedures. Each carries `ConnectionMiddleware`, and a role's, such as `RequireMerchant`. */
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>;
  /**
   * The app's own tables. The kit adds none: the migrator's own table is the mark of a store
   * that has been migrated.
   */
  readonly migrations: Migrator.Loader;
  /** The callers a socket can carry. Default: {@link MerchantCaller}. */
  readonly caller?: ActorSocket.CallerSchema<C> | undefined;
  /**
   * The app's half of the actor. Its requirements beyond the activation's own are captured in
   * the outer phase, where the Backend provides the services.
   */
  readonly build: (
    context: ShopActorContext<NoInfer<C>>,
  ) => Effect.Effect<ShopActorBuild<Rpcs, NoInfer<C>, Methods>, never, R>;
}

/** The close reasons. A reason must stay under 123 bytes. */
const UNIDENTIFIED_REASON = "unidentified connection";
const UNINSTALLED_REASON = "uninstalled";
const PLAN_CHANGED_REASON = "plan changed";

/**
 * How long `destroy` waits for the sockets it closed to finish their close handshake before it
 * aborts. An abort drops a socket whose close frame has not gone out, and the browser then sees
 * 1006, which it retries, instead of the terminal code.
 */
const CLOSE_HANDSHAKE_WAIT = "1 second";

const encodeNotice = Schema.encodeSync(NoticeFrame);
const decodeShopDomain = Schema.decodeUnknownOption(ShopDomain);

/**
 * Whether the object has never been migrated: a shop's first activation, or the first after
 * `destroy`, whose `deleteAll` removes the whole database. It looks for the migrator's own table,
 * not for any table, because Cloudflare lists hidden tables of its own (`__cf_kv`).
 */
const isEmptyStore = (storage: Workers.DurableObjectStorage) =>
  storage.sql
    .exec("select 1 from sqlite_master where type = 'table' and name = 'effect_sql_migrations'")
    .toArray().length === 0;

const requireMerchantLayer = Layer.succeed(RequireMerchant)(
  RequireMerchant.of((effect) =>
    Effect.gen(function* () {
      const caller = yield* CurrentCaller;
      if (caller.role !== "merchant") return yield* new ForbiddenError();
      return yield* effect;
    }),
  ),
);

/**
 * Reads the socket's identity, which `ActorSocket` provides around every dispatch. A message with
 * none is a broken invariant, so it dies. Every defect is logged here, since `RpcServer` only
 * sends it to the browser.
 */
const connectionMiddleware = (shop: ShopDomain) =>
  Layer.succeed(ConnectionMiddleware)(
    ConnectionMiddleware.of((effect, { rpc }) =>
      Effect.gen(function* () {
        const identity = yield* Effect.serviceOption(ActorSocket.ConnectionIdentity);
        if (Option.isNone(identity))
          return yield* Effect.die(new Error("a socket message without its identity"));
        const { caller, connectedAt } = identity.value;
        const at = DateTime.formatIso(connectedAt);
        yield* Effect.logDebug(
          `ShopActor.${rpc._tag}: shop=${shop} caller=${caller.role} connectedAt=${at}`,
        ).pipe(Effect.annotateLogs({ shop, rpc: rpc._tag, caller: caller.role, connectedAt: at }));
        return yield* Effect.provideService(effect, CurrentCaller, caller);
      }).pipe(
        logDefect(`ShopActor.${rpc._tag}: shop=${shop}`, { shop }),
        Effect.withSpan(`ShopActor.${rpc._tag}`),
      ),
    ),
  );

/**
 * Builds a shop actor's implementation, for the app's `ShopActor.make`:
 *
 * ```ts
 * export const ShopActorLive = ShopActor.make(
 *   ShopActorKit.make({ rpcs: AppRpcs, migrations, build: ({ shop, sql, notify }) => ... }),
 * );
 * ```
 *
 * What the kit owns, per activation:
 *
 * - The name. An object reached by id (`idFromString`) has no name and serves only `destroy`; any
 *   other call dies.
 * - The guard on first activation. Any call creates the object it names, so with an empty store
 *   (a new shop, or one `destroy` wiped) and no `AppInstallation` row the object refuses to start
 *   with {@link ShopNotInstalledError} and writes nothing. An uninstalled shop's actor never
 *   comes back.
 * - The app's migrations, run inside the `blockConcurrencyWhile` Alchemy wraps construction in, so
 *   no request sees a half-migrated store. The SQL client is rebuilt each activation.
 * - `fetch`: only a WebSocket upgrade (else 426), whose caller is {@link CONNECTION_HEADER}; a
 *   header that does not decode is accepted and closed with {@link CONNECTION_CLOSE_FORBIDDEN}.
 * - `notify`, `destroy`, `revoke`, and the close log.
 *
 * The outer phase takes handles only: it runs at plan time against a mock state inside the
 * Backend's init, which attaches every binding it yields to the Backend's script, and once per
 * activation at runtime, where the services are the Backend's own instances.
 */
const make = <
  Rpcs extends Rpc.Any,
  Methods extends StubMethods<Methods> = object,
  C extends Caller = MerchantCaller,
  R = never,
>(
  options: ShopActorKitOptions<Rpcs, C, Methods, R>,
): Effect.Effect<
  Effect.Effect<ShopActorShape<NoInfer<Methods>>, never, ActivationServices>,
  never,
  AppInstallations | Cloudflare.DurableObjectState | Exclude<R, ActivationServices>
> =>
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const appInstallations = yield* AppInstallations;
    const services = yield* Effect.context<Exclude<R, ActivationServices>>();
    const callerSchema = (options.caller ?? MerchantCaller) as ActorSocket.CallerSchema<C>;
    const decodeConnectionHeader = Schema.decodeUnknownOption(Schema.fromJsonString(callerSchema));
    const decodeAttachment = Schema.decodeUnknownOption(ActorSocket.attachment(callerSchema));

    return Effect.gen(function* () {
      const name = decodeShopDomain(state.id.name);
      const label = Option.getOrElse(name, () => state.id.toString());
      const runtime = yield* Effect.context<RuntimeContext>();
      if (
        isEmptyStore(state.raw.storage) &&
        Option.isNone(
          yield* Option.match(name, {
            onNone: () => Effect.succeedNone,
            onSome: (shop) => appInstallations.find(shop),
          }),
        )
      ) {
        yield* Effect.logInfo(
          `ShopActor.activate: shop=${label}: no AppInstallation, not created`,
        ).pipe(Effect.annotateLogs({ shop: label }));
        return yield* Effect.die(new ShopNotInstalledError({ shop: label }));
      }

      const closeSocket = Effect.fn("ShopActor.closeSocket")(function* (
        ws: Cloudflare.Workers.WebSocket,
        code: number,
        reason: string,
      ) {
        yield* ws
          .close(code, reason)
          .pipe(
            Effect.catchDefect((defect) =>
              Effect.logWarning(
                `ShopActor.closeSocket: shop=${label} code=${String(code)}: close failed`,
                Cause.die(defect),
              ).pipe(Effect.annotateLogs({ shop: label, code })),
            ),
          );
      });

      /**
       * Closes every socket with {@link CONNECTION_CLOSE_UNINSTALLED} (best effort), deletes the
       * alarm and then all storage, which ends the object's storage billing, syncs storage to
       * disk, waits up to {@link CLOSE_HANDSHAKE_WAIT} for the closes, and aborts with
       * {@link ABORT_UNINSTALLED}.
       *
       * SQLite-backed storage coalesces writes: `deleteAll` resolving does not mean the delete
       * reached disk, and a reset discards writes still coalescing, so it syncs before the abort.
       * Local workerd writes synchronously and never shows this. The abort matters because the
       * actor migrates once per activation: without it this activation would keep serving with its
       * tables gone. The abort lands mid-call, so the stub call rejects; `ShopActors.destroy` reads
       * that rejection as success.
       */
      const destroy = Effect.fn("ShopActor.destroy")(function* () {
        const sockets = yield* state.getWebSockets();
        for (const ws of sockets)
          yield* closeSocket(ws, CONNECTION_CLOSE_UNINSTALLED, UNINSTALLED_REASON);
        yield* state.storage.deleteAlarm();
        yield* state.storage.deleteAll();
        yield* Effect.promise(() => state.raw.storage.sync());
        const closed = yield* Effect.sync(() =>
          sockets.every((ws) => ws.ws.readyState === WebSocket.CLOSED),
        ).pipe(
          Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: (done) => done }),
          Effect.timeoutOption(CLOSE_HANDSHAKE_WAIT),
        );
        yield* Effect.logInfo(
          `ShopActor.destroy: shop=${label} sockets=${String(sockets.length)} closed=${String(Option.isSome(closed))}: storage deleted`,
        ).pipe(
          Effect.annotateLogs({
            shop: label,
            sockets: sockets.length,
            closed: Option.isSome(closed),
          }),
        );
        yield* state.abort(ABORT_UNINSTALLED);
      }, Effect.provide(runtime));

      if (Option.isNone(name)) {
        const nameless = Effect.die(new Error(`ShopActor: id=${label}: reached without its name`));
        const { reached } = crossDefects({ reached: () => nameless });
        const served: Record<string, unknown> = {
          fetch: nameless,
          alarm: () => nameless,
          ...crossDefects<ShopActorLifecycle>({ destroy, revoke: reached }),
        };
        // The app's methods are not built without a name; each answers the nameless defect.
        // Alchemy's bridge checks `Object.hasOwn` before it calls, so the descriptor trap answers.
        const own = (key: string | symbol) => typeof key !== "string" || Object.hasOwn(served, key);
        return new Proxy(served, {
          get: (target, key) => (own(key) ? (Reflect.get(target, key) as unknown) : reached),
          getOwnPropertyDescriptor: (target, key) =>
            own(key)
              ? Reflect.getOwnPropertyDescriptor(target, key)
              : { value: reached, writable: true, enumerable: true, configurable: true },
        }) as ShopActorShape<Methods>;
      }
      const shop = name.value;
      const sql = yield* Layer.build(SqliteClient.layer({ storage: state.raw.storage })).pipe(
        Effect.map((context) => Context.get(context, SqlClient.SqlClient)),
      );
      yield* SqliteMigrator.run({ loader: options.migrations }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.orDie,
      );
      yield* Effect.logDebug(`ShopActor.activate: shop=${shop}`).pipe(
        Effect.annotateLogs({ shop }),
      );

      const notify = Effect.fn("ShopActor.notify")(function* (invalidated: readonly string[]) {
        const frame = encodeNotice({ _tag: "ShopActorNotice", invalidated });
        const ownFrame = encodeNotice({ _tag: "ShopActorOwnNotice", invalidated });
        const writer = yield* Effect.serviceOption(ActorSocket.DispatchingSocket);
        const isWriter = (socket: Cloudflare.Workers.WebSocket) =>
          Option.isSome(writer) && writer.value.ws === socket.ws;
        for (const socket of yield* state.getWebSockets())
          // A socket mid-close throws on send, which `send` surfaces as a defect; the next notice
          // or the client's reconnect covers that browser.
          yield* socket
            .send(isWriter(socket) ? ownFrame : frame)
            .pipe(Effect.catchDefect(() => Effect.void));
      }, Effect.provide(runtime));

      // What is left of `R` once `services` is provided is the activation's own services, which
      // TypeScript cannot reduce for a generic `R`. The activation's values win over the outer
      // phase's, its span among them.
      const built = yield* options
        .build({
          shop,
          // `ConnectionMiddleware` provides the socket's caller, which `callerSchema` decoded.
          caller: Effect.map(Effect.service(CurrentCaller), (current) => current as C),
          sql,
          transaction: syncTransaction(sql),
          notify,
          state,
          runtime,
          closeSocket,
        })
        .pipe(
          Effect.updateContext(
            (context: Context.Context<ActivationServices>) =>
              Context.merge(services, context) as Context.Context<R>,
          ),
        );
      const hooks = built.sockets ?? {};

      const socket = yield* ActorSocket.make({
        group: options.rpcs,
        handlers: Layer.mergeAll(built.handlers, connectionMiddleware(shop), requireMerchantLayer),
        caller: callerSchema,
        tags: hooks.tags,
        beforeDispatch: hooks.beforeDispatch,
      });

      const fetch = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (request.headers.upgrade?.toLowerCase() !== "websocket")
          return HttpServerResponse.empty({ status: 426, headers: { upgrade: "websocket" } });
        const caller = decodeConnectionHeader(request.headers[CONNECTION_HEADER]);
        if (Option.isNone(caller)) {
          yield* Effect.logWarning(`ShopActor.fetch: shop=${shop}: unidentified connection`).pipe(
            Effect.annotateLogs({ shop }),
          );
          return yield* ActorSocket.refusedUpgrade(CONNECTION_CLOSE_FORBIDDEN, UNIDENTIFIED_REASON);
        }
        const identity = { caller: caller.value, connectedAt: yield* DateTime.now };
        const accepted = yield* socket.fetch(identity);
        if (Option.isSome(accepted.socket)) {
          const role = caller.value.role;
          yield* Effect.logDebug(
            `ShopActor.fetch: shop=${shop} role=${role}: socket accepted`,
          ).pipe(Effect.annotateLogs({ shop, role }));
          if (hooks.onAccept !== undefined) yield* hooks.onAccept(identity, accepted.socket.value);
        }
        return accepted.response;
      }).pipe(Effect.withSpan("ShopActor.fetch"));

      /**
       * Logs the close with the caller's role and the close code and reason, then hands the socket
       * to the transport: at Debug for a tab that closed or navigated away (1000, 1001), at Info
       * for any other code. A socket without an identity logs `role=none`.
       */
      const webSocketClose = Effect.fn("ShopActor.webSocketClose")(function* (
        ws: Cloudflare.Workers.WebSocket,
        code: number,
        reason: string,
      ) {
        const role = Option.match(
          Option.flatMap(decodeAttachment(ws.deserializeAttachment<unknown>()), ({ shopActor }) =>
            Option.fromUndefinedOr(shopActor),
          ),
          { onNone: () => "none", onSome: ({ caller }) => caller.role },
        );
        const log = code === 1000 || code === 1001 ? Effect.logDebug : Effect.logInfo;
        yield* log(
          `ShopActor.webSocketClose: shop=${shop} role=${role} code=${String(code)}${reason === "" ? "" : `: ${reason}`}`,
        ).pipe(Effect.annotateLogs({ shop, role, code, reason }));
        yield* socket.webSocketClose(ws);
      });

      /**
       * Closes every open socket of the shop with {@link CONNECTION_CLOSE_REVOKED}, and answers how
       * many it closed. A socket is checked at connect only, so this is what makes the gate's new
       * answer reach an open tab: each reconnect asks the gate again.
       */
      const revoke = Effect.fn("ShopActor.revoke")(function* () {
        let closed = 0;
        for (const ws of yield* state.getWebSockets()) {
          if (ws.ws.readyState !== WebSocket.OPEN) continue;
          yield* closeSocket(ws, CONNECTION_CLOSE_REVOKED, PLAN_CHANGED_REASON);
          closed += 1;
        }
        yield* Effect.logInfo(`ShopActor.revoke: shop=${shop} closed=${String(closed)}`).pipe(
          Effect.annotateLogs({ shop, closed }),
        );
        return { closed };
      }, Effect.provide(runtime));

      const alarm = built.alarm;
      const lifecycle: ShopActorLifecycle = { destroy, revoke };
      return {
        fetch,
        webSocketMessage: socket.webSocketMessage,
        webSocketClose,
        webSocketError: socket.webSocketError,
        ...(alarm === undefined ? {} : { alarm: () => alarm().pipe(Effect.provide(runtime)) }),
        // An app with no methods leaves `Methods` at its default, `object`.
        ...((built.methods === undefined ? {} : crossDefects(built.methods)) as Methods),
        ...crossDefects(lifecycle),
      };
    }).pipe(Effect.withSpan("ShopActor.activate"));
  });

/** Builds an app's shop actor; see {@link make}. */
export const ShopActorKit = { make } as const;
