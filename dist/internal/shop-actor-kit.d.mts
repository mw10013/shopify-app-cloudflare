import { ShopDomain } from "./domain.mjs";
import { Caller, ConnectionMiddleware, CurrentCaller, MerchantCaller, RequireMerchant } from "./shop-actor-contract.mjs";
import { AppInstallations } from "./shopify-access.mjs";
import { CallerSchema, SocketIdentity } from "./actor-socket.mjs";
import { Transaction } from "./transaction.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { RuntimeContext } from "alchemy";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Migrator from "effect/sql/Migrator";
/**
 * The reason `destroy` aborts the object with. The stub call it lands in rejects with an `Error`
 * of this message, which is how `ShopActors.destroy` tells the abort from a failure.
 */
export declare const ABORT_UNINSTALLED = "uninstalled";
declare const ShopNotInstalledError_base: Schema.Class<ShopNotInstalledError, Schema.TaggedStruct<"ShopNotInstalledError", {
  readonly shop: Schema.String;
}>, Cause.YieldableError>;
/**
 * What the actor's first activation dies with when the shop has no `AppInstallation`. It writes
 * nothing, so `ShopActors.destroy` reads it as a store already empty: a shop whose actor never
 * started, or a repeated uninstall. It dies inside the object's constructor, so the stub call
 * rejects with it as a plain `Error` that keeps its own fields, `_tag` among them (measured in
 * workerd 1.20261026.1, baton#75). `shop` is the object's name, or its id when it has none.
 */
export declare class ShopNotInstalledError extends ShopNotInstalledError_base {
  get message(): string;
}
/** The stub methods the kit serves on every shop actor, beside the app's own. */
export interface ShopActorLifecycle {
  /** Uninstall: closes every socket, deletes the alarm and all storage, and aborts the object. */
  readonly destroy: () => Effect.Effect<void>;
  /** A plan change: closes every open socket so each reconnect meets the gate again. */
  readonly revoke: () => Effect.Effect<{
    readonly closed: number;
  }>;
}
/**
 * The shape an app declares its `ShopActor` class with: the kit's {@link ShopActorLifecycle} and
 * the app's own stub methods, which only the Backend can call.
 *
 * A value that carries an instant crosses as its schema's `Encoded` form: the stub is Workers RPC,
 * which refuses an object with a prototype of its own, and a `DateTime.Utc` is one.
 */
export type ShopActorShape<Methods extends StubMethods<Methods> = object> = ShopActorLifecycle & Methods;
/** An app's own stub methods: each answers an Effect, as Workers RPC on the stub requires. */
export type StubMethods<Methods> = { readonly [K in keyof Methods]: (...args: never) => Effect.Effect<unknown>; };
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
  readonly closeSocket: (socket: Cloudflare.Workers.WebSocket, code: number, reason: string) => Effect.Effect<void>;
}
/**
 * The socket hooks an app with more than one socket per caller sets: baton's displacement, which
 * tags each member's socket and closes the oldest with `CONNECTION_CLOSE_DISPLACED`.
 */
export interface ShopActorSocketHooks<C extends Caller> {
  /** Tags written onto a socket when it is accepted, which `state.getWebSockets(tag)` reads. */
  readonly tags?: ((identity: SocketIdentity<C>) => readonly string[]) | undefined;
  /** Runs after a socket is accepted, with the accepted socket. */
  readonly onAccept?: ((identity: SocketIdentity<C>, socket: Cloudflare.Workers.WebSocket) => Effect.Effect<void>) | undefined;
  /** Runs before each message is dispatched; false declines it (the hook closes the socket). */
  readonly beforeDispatch?: ((identity: SocketIdentity<C>, socket: Cloudflare.Workers.WebSocket) => Effect.Effect<boolean>) | undefined;
}
/** The middleware the kit provides itself. */
type KitMiddleware = ConnectionMiddleware | RequireMerchant;
/** What an app's `build` answers. */
export interface ShopActorBuild<Rpcs extends Rpc.Any, C extends Caller, Methods extends StubMethods<Methods>> {
  /** The app's procedure handlers, and any middleware of its own beyond the kit's. */
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs> | Exclude<Rpc.Middleware<Rpcs>, KitMiddleware>>;
  /** The app's stub methods, served beside {@link ShopActorLifecycle}. */
  readonly methods?: Methods | undefined;
  /** The actor's alarm. */
  readonly alarm?: (() => Effect.Effect<void>) | undefined;
  readonly sockets?: ShopActorSocketHooks<C> | undefined;
}
/** The services the object provides to its activation. */
type ActivationServices = RuntimeContext | Cloudflare.DurableObjectState | Scope.Scope;
export interface ShopActorKitOptions<Rpcs extends Rpc.Any, C extends Caller, Methods extends StubMethods<Methods>, R> {
  /** The app's procedures. Each carries `ConnectionMiddleware`, and a role's, such as `RequireMerchant`. */
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>;
  /**
   * The app's own tables. The kit adds none: the migrator's own table is the mark of a store
   * that has been migrated.
   */
  readonly migrations: Migrator.Loader;
  /** The callers a socket can carry. Default: {@link MerchantCaller}. */
  readonly caller?: CallerSchema<C> | undefined;
  /**
   * The app's half of the actor. Its requirements beyond the activation's own are captured in
   * the outer phase, where the Backend provides the services.
   */
  readonly build: (context: ShopActorContext<NoInfer<C>>) => Effect.Effect<ShopActorBuild<Rpcs, NoInfer<C>, Methods>, never, R>;
}
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
declare const make: <Rpcs extends Rpc.Any, Methods extends StubMethods<Methods> = object, C extends Caller = MerchantCaller, R = never>(options: ShopActorKitOptions<Rpcs, C, Methods, R>) => Effect.Effect<Effect.Effect<ShopActorShape<NoInfer<Methods>>, never, ActivationServices>, never, AppInstallations | Cloudflare.DurableObjectState | Exclude<R, ActivationServices>>;
/** Builds an app's shop actor; see {@link make}. */
export declare const ShopActorKit: {
  readonly make: typeof make;
};
export {};