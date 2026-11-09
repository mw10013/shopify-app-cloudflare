import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
/** The gate could not answer (a 503), WebSocket's "try again later". The browser retries. */
export declare const CONNECTION_CLOSE_TRY_AGAIN = 1013;
/**
 * Every socket of a shop whose plan changed (`revoke`). Not a refusal: the browser reconnects
 * through the gate, which answers the new plan.
 */
export declare const CONNECTION_CLOSE_REVOKED = 3401;
/** A Shopify ID token the gate rejects (a 401). Terminal. */
export declare const CONNECTION_CLOSE_UNAUTHENTICATED = 4401;
/** The shop holds no app subscription (a 402). Terminal; the browser goes to plan selection. */
export declare const CONNECTION_CLOSE_PAYMENT_REQUIRED = 4402;
/**
 * A socket that may not open this shop: a token for another shop (a 403), or a socket whose
 * {@link CONNECTION_HEADER} does not decode. Terminal.
 */
export declare const CONNECTION_CLOSE_FORBIDDEN = 4403;
/** A caller who is not a member of the shop. Terminal. Reserved for apps with a member role. */
export declare const CONNECTION_CLOSE_NOT_A_MEMBER = 4404;
/** Another socket of the same member took this one's place. Terminal, so two tabs never trade. */
export declare const CONNECTION_CLOSE_DISPLACED = 4409;
/**
 * The shop has no app installation: the gate's 410, and every socket when the actor is
 * destroyed on uninstall. Terminal: the actor and its data are gone.
 */
export declare const CONNECTION_CLOSE_UNINSTALLED = 4410;
/**
 * The header naming a socket's caller, as JSON. Only the Backend's gate sets it, on an upgrade
 * it rebuilds from nothing, so a browser cannot set it.
 */
export declare const CONNECTION_HEADER = "x-actor-connection";
/** The path a browser opens its actor socket on: `<ACTOR_PATH>/<shop>`. */
export declare const ACTOR_PATH = "/api/actor";
/**
 * What the actor pushes to every socket after a write: the reactivity keys whose reads are
 * stale, never the data. Carried on the RPC socket as its own frame, outside the RPC protocol.
 */
export declare const Notice: Schema.Struct<{
  readonly _tag: Schema.Literal<"ShopActorNotice">;
  readonly invalidated: Schema.$Array<Schema.String>;
}>;
export type Notice = typeof Notice.Type;
/**
 * The {@link Notice} the socket that made the write gets instead, sent before the write's
 * answer, so the tab that wrote reads at once, unthrottled.
 */
export declare const OwnNotice: Schema.Struct<{
  readonly _tag: Schema.Literal<"ShopActorOwnNotice">;
  readonly invalidated: Schema.$Array<Schema.String>;
}>;
export type OwnNotice = typeof OwnNotice.Type;
/** A {@link Notice} or an {@link OwnNotice} as the JSON text frame it travels in. */
export declare const NoticeFrame: Schema.fromJsonString<Schema.Union<readonly [Schema.Struct<{
  readonly _tag: Schema.Literal<"ShopActorNotice">;
  readonly invalidated: Schema.$Array<Schema.String>;
}>, Schema.Struct<{
  readonly _tag: Schema.Literal<"ShopActorOwnNotice">;
  readonly invalidated: Schema.$Array<Schema.String>;
}>]>>;
/**
 * Who is on a socket. Every role carries its `role`; an app with more than the merchant gives the
 * kit its own union.
 */
export interface Caller {
  readonly role: string;
}
/**
 * A merchant: whoever presented a Shopify ID token for the shop. Its token is checked at connect
 * only.
 */
export declare const MerchantCaller: Schema.Struct<{
  readonly role: Schema.Literal<"merchant">;
}>;
export type MerchantCaller = typeof MerchantCaller.Type;
declare const ForbiddenError_base: Schema.Class<ForbiddenError, Schema.TaggedStruct<"ForbiddenError", {}>, import("effect/Cause").YieldableError>;
/** A procedure's caller is not the role the procedure admits. */
export declare class ForbiddenError extends ForbiddenError_base {}
declare const CurrentCaller_base: Context.ServiceClass<CurrentCaller, "app/CurrentCaller", Caller>;
/** The caller of the current procedure, provided by {@link ConnectionMiddleware}. */
export declare class CurrentCaller extends CurrentCaller_base {}
declare const ConnectionMiddleware_base: RpcMiddleware.ServiceClass<ConnectionMiddleware, "app/ConnectionMiddleware", CurrentCaller, Schema.Never, never, never, false>;
/**
 * Provides {@link CurrentCaller}: the caller written into the socket when it was accepted, from
 * {@link CONNECTION_HEADER}. Nothing a message carries is read. Every procedure carries it, added
 * last so it runs outermost.
 */
export declare class ConnectionMiddleware extends ConnectionMiddleware_base {}
declare const RequireMerchant_base: RpcMiddleware.ServiceClass<RequireMerchant, "app/RequireMerchant", never, typeof ForbiddenError, never, CurrentCaller, false>;
/** Admits a `merchant` caller only. */
export declare class RequireMerchant extends RequireMerchant_base {}
export {};