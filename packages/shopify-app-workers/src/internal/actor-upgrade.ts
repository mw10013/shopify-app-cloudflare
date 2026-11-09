/**
 * The Backend's upgrade path to its shop actors: the shop from the URL, the merchant gate, and
 * the socket forwarded to the shop's actor as the caller the gate resolved.
 *
 * @module
 */

import type * as Cloudflare from "@alchemy.run/cloudflare";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { refusedUpgrade } from "./actor-socket.ts";
import { ShopDomain } from "./domain.ts";
import { MerchantGate } from "./merchant-gate.ts";
import {
  ACTOR_PATH,
  CONNECTION_CLOSE_FORBIDDEN,
  CONNECTION_CLOSE_PAYMENT_REQUIRED,
  CONNECTION_CLOSE_TRY_AGAIN,
  CONNECTION_CLOSE_UNAUTHENTICATED,
  CONNECTION_CLOSE_UNINSTALLED,
  CONNECTION_HEADER,
  MerchantCaller,
} from "./shop-actor-contract.ts";
import type { ShopActorLifecycle } from "./shop-actor-kit.ts";

/** `/api/actor/<shop>` ({@link ACTOR_PATH}) split on `/`, optionally with a trailing slash. */
const ActorPath = Schema.Union([
  Schema.Tuple([Schema.Literal(""), Schema.Literal("api"), Schema.Literal("actor"), ShopDomain]),
  Schema.Tuple([
    Schema.Literal(""),
    Schema.Literal("api"),
    Schema.Literal("actor"),
    ShopDomain,
    Schema.Literal(""),
  ]),
]);
const decodeActorPath = Schema.decodeUnknownOption(ActorPath);

/** The shop of an {@link ActorPath}; None for any other path. A tuple rejects extra segments. */
export const actorKeyFromPath = (pathname: string): Option.Option<ShopDomain> =>
  Option.map(decodeActorPath(pathname.split("/")), (segments) => segments[3]);

/** Whether a path is addressed to an actor at all, so one that names no shop is 404. */
export const isActorPath = (pathname: string) =>
  pathname === ACTOR_PATH || pathname.startsWith(`${ACTOR_PATH}/`);

/** The headers a WebSocket handshake itself needs: the only ones a forwarded upgrade keeps. */
const FORWARDED_HANDSHAKE_HEADERS = [
  "upgrade",
  "connection",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
  "sec-websocket-extensions",
] as const;

const encodeMerchantHeader = Schema.encodeSync(Schema.fromJsonString(MerchantCaller));

/**
 * The upgrade the actor sees: rebuilt from nothing but the handshake headers and
 * {@link CONNECTION_HEADER} naming the caller as JSON. The merchant's `?token=`, the cookie and
 * any incoming `x-actor-*` header never reach the actor, so a browser cannot name itself.
 */
export const forwardedUpgrade = (
  request: HttpServerRequest.HttpServerRequest,
  pathname: string,
  connection: string,
) => {
  const headers = new Headers();
  for (const name of FORWARDED_HANDSHAKE_HEADERS) {
    const value = request.headers[name];
    if (value !== undefined) headers.set(name, value);
  }
  headers.set(CONNECTION_HEADER, connection);
  return HttpServerRequest.fromWeb(
    new Request(new URL(pathname, "http://backend"), { method: "GET", headers }),
  );
};

/**
 * The gate's refusal, as the HTTP status it stands for: 401 a token it rejects, 402 a shop with
 * no app subscription, 403 a token for another shop, 410 a shop with no `AppInstallation` row,
 * 503 a gate that could not answer.
 */
type GateRefusal = 401 | 402 | 403 | 410 | 503;

/** The gate's refusal as the close code the browser reads, with a short reason. */
export const refusalClose = (status: GateRefusal) =>
  Match.value(status).pipe(
    Match.when(401, () => ({ code: CONNECTION_CLOSE_UNAUTHENTICATED, reason: "unauthenticated" })),
    Match.when(402, () => ({
      code: CONNECTION_CLOSE_PAYMENT_REQUIRED,
      reason: "payment required",
    })),
    Match.when(403, () => ({ code: CONNECTION_CLOSE_FORBIDDEN, reason: "forbidden" })),
    Match.when(410, () => ({ code: CONNECTION_CLOSE_UNINSTALLED, reason: "uninstalled" })),
    Match.when(503, () => ({ code: CONNECTION_CLOSE_TRY_AGAIN, reason: "try again" })),
    Match.exhaustive,
  );

const isUpgrade = (request: HttpServerRequest.HttpServerRequest) =>
  request.method === "GET" && request.headers.upgrade?.toLowerCase() === "websocket";

/**
 * The Backend's `fetch` branch for {@link isActorPath}, over the app's `ShopActor` binding:
 *
 * ```ts
 * const upgrade = yield* actorUpgrade(ShopActor);
 * if (isActorPath(pathname)) return yield* upgrade(request);
 * ```
 *
 * A path that names no shop is 404, anything but a WebSocket upgrade 426: there is no HTTP RPC
 * into the actor. The merchant's Shopify ID token arrives as `?token=`, because a browser cannot
 * set a header on an upgrade. The gate verifies it (never exchanges it: the `/app` guard did),
 * checks its shop is the socket's before any read, and requires an active plan. A D1 failure and
 * a plan that could not be read are both 503, so an outage never reads as "uninstalled" and the
 * browser retries. A refusal is a socket closed at once with its {@link refusalClose} code.
 */
export const actorUpgrade = Effect.fn("actorUpgrade")(function* <
  Shape extends ShopActorLifecycle,
  R,
>(actor: Effect.Effect<Cloudflare.DurableObject<Shape>, never, R>) {
  const actors = yield* actor;
  const gate = yield* MerchantGate;

  const merchantGate = Effect.fn("Backend.merchantGate")(
    function* (key: ShopDomain, token: string | null) {
      if (token === null) return yield* Effect.fail<GateRefusal>(401);
      const shop = yield* gate
        .verifiedShop(token)
        .pipe(Effect.catchTag("InvalidIdTokenError", () => Effect.fail<GateRefusal>(401)));
      if (shop !== key) return yield* Effect.fail<GateRefusal>(403);
      const standing = yield* gate.merchantStanding(token).pipe(
        Effect.catchTags({
          InvalidIdTokenError: () => Effect.fail<GateRefusal>(401),
          AppNotInstalledError: () => Effect.fail<GateRefusal>(410),
          ShopifyUnavailableError: (error) =>
            Effect.logError(
              `Backend.merchantGate: shop=${key}: plan resolution failed`,
              Cause.fail(error),
            ).pipe(
              Effect.annotateLogs({ shop: key }),
              Effect.andThen(Effect.fail<GateRefusal>(503)),
            ),
        }),
      );
      if (standing.status._tag === "Unsubscribed") return yield* Effect.fail<GateRefusal>(402);
      return encodeMerchantHeader({ role: "merchant" });
    },
    (effect, key) =>
      effect.pipe(
        Effect.catchDefect((defect) =>
          Effect.logError(
            `Backend.merchantGate: shop=${key}: lookup failed`,
            Cause.die(defect),
          ).pipe(Effect.annotateLogs({ shop: key }), Effect.andThen(Effect.fail<GateRefusal>(503))),
        ),
      ),
  );

  const forwardToActor = Effect.fn("Backend.forwardToActor")(function* (
    key: ShopDomain,
    request: HttpServerRequest.HttpServerRequest,
  ) {
    if (!isUpgrade(request))
      return HttpServerResponse.empty({ status: 426, headers: { upgrade: "websocket" } });
    const url = new URL(request.url, "http://backend");
    const connection = yield* merchantGate(key, url.searchParams.get("token")).pipe(Effect.result);
    if (connection._tag === "Failure") {
      const { code, reason } = refusalClose(connection.failure);
      yield* Effect.logDebug(
        `Backend.forwardToActor: shop=${key} code=${String(code)}: refused`,
      ).pipe(Effect.annotateLogs({ shop: key, code }));
      return yield* refusedUpgrade(code, reason);
    }
    return yield* actors
      .getByName(key)
      .fetch(forwardedUpgrade(request, url.pathname, connection.success));
  });

  return (request: HttpServerRequest.HttpServerRequest) =>
    Option.match(actorKeyFromPath(new URL(request.url, "http://backend").pathname), {
      onNone: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
      onSome: (key) => forwardToActor(key, request),
    });
});
