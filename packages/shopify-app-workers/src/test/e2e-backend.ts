/**
 * The e2e routes an app's `e2e` stage Backend serves in front of its own `fetch`
 * ({@link withE2eRoutes}): what the end-to-end spec pack reads of the Backend's state, which
 * Shopify's admin does not show. The tunnel makes the `e2e` stage public, so each route needs the
 * session's token ({@link E2eAccess}), and only a Backend that only the `e2e` stage deploys may
 * serve them.
 *
 * - The status route ({@link E2E_STATUS_PATH}) answers a shop's `AppInstallation` row as an
 *   {@link E2eShopStatus}, for the session's shop alone.
 * - The webhook record ({@link E2E_WEBHOOKS_PATH}) answers each request the Backend answered
 *   under `/webhooks/`, so the suite can tell that a webhook Shopify delivered through the tunnel
 *   passed its HMAC check and was answered 200, which `shopify app webhook trigger` reports only
 *   as enqueued. Each entry keeps the request's shop header and its
 *   {@link E2E_WEBHOOK_MARKER_PARAM}, so the suite finds the delivery of its own trigger. It is
 *   gated by the token but for no shop: Shopify's sample deliveries name `shop.myshopify.com`, not
 *   the leased store. The record lives in the Backend's isolate, so it starts empty with each
 *   server, and keeps the {@link RECORD_LIMIT} latest requests.
 *
 * @module
 */

import { timingSafeEqual } from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ShopDomain } from "#internal/domain.ts";
import {
  E2E_WEBHOOK_MARKER_PARAM,
  E2eShopStatus,
  E2eWebhookDeliveries,
  type E2eWebhookDelivery,
} from "#internal/e2e-status.ts";
import { AppInstallations } from "#internal/shopify-access.ts";

import {
  E2E_STATUS_PATH,
  E2E_TOKEN_HEADER,
  E2E_WEBHOOKS_PATH,
  type E2eAccess,
  e2eAccessConfig,
} from "./e2e-session.ts";

const RECORD_LIMIT = 100;

const decodeShop = Schema.decodeUnknownOption(ShopDomain);
const encodeStatus = Schema.encodeEffect(E2eShopStatus);
const encodeDeliveries = Schema.encodeEffect(E2eWebhookDeliveries);

/** Constant time over equal lengths; a token's length is not a secret. */
export const tokenMatches = (expected: Redacted.Redacted, given: string | undefined) => {
  if (given === undefined) return false;
  const a = new TextEncoder().encode(Redacted.value(expected));
  const b = new TextEncoder().encode(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

const authorized = (
  access: Option.Option<E2eAccess>,
  request: HttpServerRequest.HttpServerRequest,
) => Option.isSome(access) && tokenMatches(access.value.token, request.headers[E2E_TOKEN_HEADER]);

/**
 * The status route's handler: `401` without the session's token in {@link E2E_TOKEN_HEADER} (every
 * request when `access` is `None`), `405` for anything but GET, `400` without a valid `shop`,
 * `403` for any shop but the session's, else the shop's {@link E2eShopStatus}.
 */
export const e2eStatus = Effect.fn("E2eStatus.make")(function* (access: Option.Option<E2eAccess>) {
  const installations = yield* AppInstallations;
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (Option.isNone(access) || !authorized(access, request))
      return HttpServerResponse.empty({ status: 401 });
    if (request.method !== "GET") return HttpServerResponse.empty({ status: 405 });
    const shop = decodeShop(new URL(request.url, "http://backend").searchParams.get("shop"));
    if (Option.isNone(shop))
      return HttpServerResponse.text("shop must be a <name>.myshopify.com domain", {
        status: 400,
      });
    if (shop.value !== access.value.shop) return HttpServerResponse.empty({ status: 403 });
    const row = Option.match(yield* installations.find(shop.value), {
      onNone: () => ({ installed: false, planHandle: null, installedAt: null }),
      onSome: ({ planHandle, installedAt }) => ({ installed: true, planHandle, installedAt }),
    });
    const status = yield* encodeStatus({ shop: shop.value, ...row }).pipe(Effect.orDie);
    return HttpServerResponse.jsonUnsafe(status);
  });
});

/**
 * The webhook record and its route. `record` notes one `/webhooks/*` request and the response it
 * got; `route` answers `401` without the session's token in {@link E2E_TOKEN_HEADER} (every
 * request when `access` is `None`), `405` for anything but GET, else the
 * {@link E2eWebhookDeliveries}.
 */
export const e2eWebhooks = Effect.fn("E2eWebhooks.make")(function* (
  access: Option.Option<E2eAccess>,
) {
  const deliveries = yield* Ref.make<readonly E2eWebhookDelivery[]>([]);

  const record = (
    request: HttpServerRequest.HttpServerRequest,
    response: HttpServerResponse.HttpServerResponse,
  ) =>
    Effect.gen(function* () {
      const delivery: E2eWebhookDelivery = {
        topic: request.headers["x-shopify-topic"] ?? null,
        webhookId: request.headers["x-shopify-webhook-id"] ?? null,
        shop: request.headers["x-shopify-shop-domain"] ?? null,
        marker: new URL(request.url, "http://backend").searchParams.get(E2E_WEBHOOK_MARKER_PARAM),
        status: response.status,
        receivedAt: yield* DateTime.now,
      };
      yield* Ref.update(deliveries, (all) => [...all, delivery].slice(-RECORD_LIMIT));
    });

  const route = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (!authorized(access, request)) return HttpServerResponse.empty({ status: 401 });
      if (request.method !== "GET") return HttpServerResponse.empty({ status: 405 });
      const body = yield* encodeDeliveries({ deliveries: yield* Ref.get(deliveries) }).pipe(
        Effect.orDie,
      );
      return HttpServerResponse.jsonUnsafe(body);
    });

  return { record, route };
});

/**
 * An app's Backend body with the e2e routes in front of its `fetch`, gated by the session the
 * stack binds ({@link e2eAccessConfig}); each `/webhooks/*` answer is recorded on its way out. The
 * body's other members, its binding methods, are kept as they are.
 *
 * Only a Backend Worker that only the `e2e` stage deploys may serve this body: the app declares
 * that Worker apart from its production Backend, with the same props and layers, and its stack
 * picks it on `e2e` alone, so no other stage can answer the routes.
 *
 * @example
 * ```ts
 * export default class E2eBackend extends Cloudflare.Worker<E2eBackend>()(
 *   "E2eBackend",
 *   { ...backendProps, main: import.meta.filename },
 *   provideBackend(withE2eRoutes(backendBody), productionShopifyApp),
 * ) {}
 * ```
 */
export const withE2eRoutes = <FE, FR, Methods, E, R>(
  body: Effect.Effect<
    { readonly fetch: Effect.Effect<HttpServerResponse.HttpServerResponse, FE, FR> } & Methods,
    E,
    R
  >,
) =>
  Effect.gen(function* () {
    const access = yield* e2eAccessConfig;
    const status = yield* e2eStatus(access);
    const webhooks = yield* e2eWebhooks(access);
    const { fetch: appFetch, ...methods } = yield* body;
    const fetch = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const { pathname } = new URL(request.url, "http://backend");
      if (pathname === E2E_STATUS_PATH) return yield* status;
      if (pathname === E2E_WEBHOOKS_PATH) return yield* webhooks.route(request);
      const response = yield* appFetch;
      if (pathname.startsWith("/webhooks/")) yield* webhooks.record(request, response);
      return response;
    });
    return { ...methods, fetch };
  });
