import { ShopDomain } from "./domain.mjs";
import { MerchantGate } from "./merchant-gate.mjs";
import { ShopActorLifecycle } from "./shop-actor-kit.mjs";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
/** The shop of an {@link ActorPath}; None for any other path. A tuple rejects extra segments. */
export declare const actorKeyFromPath: (pathname: string) => Option.Option<ShopDomain>;
/** Whether a path is addressed to an actor at all, so one that names no shop is 404. */
export declare const isActorPath: (pathname: string) => boolean;
/**
 * The upgrade the actor sees: rebuilt from nothing but the handshake headers and
 * {@link CONNECTION_HEADER} naming the caller as JSON. The merchant's `?token=`, the cookie and
 * any incoming `x-actor-*` header never reach the actor, so a browser cannot name itself.
 */
export declare const forwardedUpgrade: (request: HttpServerRequest.HttpServerRequest, pathname: string, connection: string) => HttpServerRequest.HttpServerRequest;
/**
 * The gate's refusal, as the HTTP status it stands for: 401 a token it rejects, 402 a shop with
 * no app subscription, 403 a token for another shop, 404 a caller who is not a member of the
 * shop, 410 a shop with no `AppInstallation` row, 503 a gate that could not answer.
 */
export type GateRefusal = 401 | 402 | 403 | 404 | 410 | 503;
/**
 * Admits an upgrade to the shop `key`: its caller encoded as {@link CONNECTION_HEADER}'s JSON, or
 * the refusal. It runs before anything is forwarded, so it reads only what it has verified.
 */
export type ActorGate = (key: ShopDomain, request: HttpServerRequest.HttpServerRequest) => Effect.Effect<string, GateRefusal>;
/** The gate's refusal as the close code the browser reads, with a short reason. */
export declare const refusalClose: (status: GateRefusal) => {
  code: number;
  reason: string;
} | {
  code: number;
  reason: string;
} | {
  code: number;
  reason: string;
} | {
  code: number;
  reason: string;
} | {
  code: number;
  reason: string;
} | {
  code: number;
  reason: string;
};
/**
 * The merchant gate, {@link actorUpgrade}'s default. The merchant's Shopify ID token arrives as
 * `?token=`, because a browser cannot set a header on an upgrade. The gate verifies it (never
 * exchanges it: the `/app` guard did), checks its shop is the socket's before any read, and
 * requires an active plan. A D1 failure and a plan that could not be read are both 503, so an
 * outage never reads as "uninstalled" and the browser retries.
 */
export declare const merchantGate: Effect.Effect<ActorGate, never, MerchantGate>;
/**
 * The Backend's `fetch` branch for {@link isActorPath}, over the app's `ShopActor` binding:
 *
 * ```ts
 * const upgrade = yield* actorUpgrade(ShopActor);
 * if (isActorPath(pathname)) return yield* upgrade(request);
 * ```
 *
 * A path that names no shop is 404, anything but a WebSocket upgrade 426: there is no HTTP RPC
 * into the actor. `gate` admits the upgrade, {@link merchantGate} by default; an app with other
 * roles passes its own. A refusal is a socket closed at once with its {@link refusalClose} code.
 */
export declare const actorUpgrade: <Shape extends ShopActorLifecycle, R, RG = MerchantGate>(actor: Effect.Effect<Cloudflare.DurableObject<Shape>, never, R>, options?: {
  readonly gate?: Effect.Effect<ActorGate, never, RG> | undefined;
} | undefined) => Effect.Effect<(request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> | Effect.Effect<HttpServerResponse.HttpServerResponse, import("effect/http/HttpServerError").HttpServerError, never>, never, R | RG>;