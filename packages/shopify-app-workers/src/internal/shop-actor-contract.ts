/**
 * What crosses between a shop actor, the Backend's gate and the browser: the close codes, the
 * notice frames, the caller a socket carries and the middleware every procedure runs under. Free
 * of Alchemy and of `@shopify/shopify-api`, so the browser imports it.
 *
 * The close codes are a frozen contract. The Website and the Backend deploy separately, so a
 * browser can run another version than the actor: a release may add a code but never renumbers or
 * removes one.
 *
 * @module
 */

import * as Context from "effect/Context";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";

/** The gate could not answer (a 503), WebSocket's "try again later". The browser retries. */
export const CONNECTION_CLOSE_TRY_AGAIN = 1013;

/**
 * Every socket of a shop whose plan changed (`revoke`). Not a refusal: the browser reconnects
 * through the gate, which answers the new plan.
 */
export const CONNECTION_CLOSE_REVOKED = 3401;

/** A Shopify ID token the gate rejects (a 401). Terminal. */
export const CONNECTION_CLOSE_UNAUTHENTICATED = 4401;

/** The shop holds no app subscription (a 402). Terminal; the browser goes to plan selection. */
export const CONNECTION_CLOSE_PAYMENT_REQUIRED = 4402;

/**
 * A socket that may not open this shop: a token for another shop (a 403), or a socket whose
 * {@link CONNECTION_HEADER} does not decode. Terminal.
 */
export const CONNECTION_CLOSE_FORBIDDEN = 4403;

/** A caller who is not a member of the shop. Terminal. Reserved for apps with a member role. */
export const CONNECTION_CLOSE_NOT_A_MEMBER = 4404;

/** Another socket of the same member took this one's place. Terminal, so two tabs never trade. */
export const CONNECTION_CLOSE_DISPLACED = 4409;

/**
 * The shop has no app installation: the gate's 410, and every socket when the actor is
 * destroyed on uninstall. Terminal: the actor and its data are gone.
 */
export const CONNECTION_CLOSE_UNINSTALLED = 4410;

/**
 * The header naming a socket's caller, as JSON. Only the Backend's gate sets it, on an upgrade
 * it rebuilds from nothing, so a browser cannot set it.
 */
export const CONNECTION_HEADER = "x-actor-connection";

/** The path a browser opens its actor socket on: `<ACTOR_PATH>/<shop>`. */
export const ACTOR_PATH = "/api/actor";

/**
 * What the actor pushes to every socket after a write: the reactivity keys whose reads are
 * stale, never the data. Carried on the RPC socket as its own frame, outside the RPC protocol.
 */
export const Notice = Schema.Struct({
  _tag: Schema.Literal("ShopActorNotice"),
  invalidated: Schema.Array(Schema.String),
});
export type Notice = typeof Notice.Type;

/**
 * The {@link Notice} the socket that made the write gets instead, sent before the write's
 * answer, so the tab that wrote reads at once, unthrottled.
 */
export const OwnNotice = Schema.Struct({
  _tag: Schema.Literal("ShopActorOwnNotice"),
  invalidated: Schema.Array(Schema.String),
});
export type OwnNotice = typeof OwnNotice.Type;

/** A {@link Notice} or an {@link OwnNotice} as the JSON text frame it travels in. */
export const NoticeFrame = Schema.fromJsonString(Schema.Union([Notice, OwnNotice]));

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
export const MerchantCaller = Schema.Struct({ role: Schema.Literal("merchant") });
export type MerchantCaller = typeof MerchantCaller.Type;

/** A procedure's caller is not the role the procedure admits. */
export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()("ForbiddenError", {}) {}

/** The caller of the current procedure, provided by {@link ConnectionMiddleware}. */
export class CurrentCaller extends Context.Service<CurrentCaller, Caller>()("app/CurrentCaller") {}

/**
 * Provides {@link CurrentCaller}: the caller written into the socket when it was accepted, from
 * {@link CONNECTION_HEADER}. Nothing a message carries is read. Every procedure carries it, added
 * last so it runs outermost.
 */
export class ConnectionMiddleware extends RpcMiddleware.Service<
  ConnectionMiddleware,
  { provides: CurrentCaller }
>()("app/ConnectionMiddleware") {}

/** Admits a `merchant` caller only. */
export class RequireMerchant extends RpcMiddleware.Service<
  RequireMerchant,
  { requires: CurrentCaller }
>()("app/RequireMerchant", { error: ForbiddenError }) {}
