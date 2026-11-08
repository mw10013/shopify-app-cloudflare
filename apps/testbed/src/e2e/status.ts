/**
 * The e2e status route: what the end-to-end suite reads of the Backend's state, which Shopify's
 * admin does not show. Only the `E2eBackend` Worker serves it, and only the `e2e` stage deploys that
 * Worker, so no other stage can answer it. The tunnel makes the `e2e` stage public, so the route
 * also needs the session's token ({@link E2eAccess}) and answers only for the session's shop.
 *
 * @module
 */

import { timingSafeEqual } from "node:crypto";

import { AppInstallations, ShopDomain } from "@mw10013/shopify-app-workers/backend";
import { E2eShopStatus } from "@mw10013/shopify-app-workers/contract";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { E2E_TOKEN_HEADER, type E2eAccess } from "./session.ts";

/** `GET /api/e2e/status?shop=<shop>.myshopify.com`, which the Website forwards to the Backend. */
export const E2E_STATUS_PATH = "/api/e2e/status";

const decodeShop = Schema.decodeUnknownOption(ShopDomain);
const encodeStatus = Schema.encodeEffect(E2eShopStatus);

/** Constant time over equal lengths; a token's length is not a secret. */
export const tokenMatches = (expected: Redacted.Redacted, given: string | undefined) => {
  if (given === undefined) return false;
  const a = new TextEncoder().encode(Redacted.value(expected));
  const b = new TextEncoder().encode(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The route's handler: `401` without the session's token in {@link E2E_TOKEN_HEADER} (every
 * request when `access` is `None`), `405` for anything but GET, `400` without a valid `shop`,
 * `403` for any shop but the session's, else the shop's {@link E2eShopStatus}.
 */
export const e2eStatus = Effect.fn("E2eStatus.make")(function* (access: Option.Option<E2eAccess>) {
  const installations = yield* AppInstallations;
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const given = request.headers[E2E_TOKEN_HEADER];
    if (Option.isNone(access) || !tokenMatches(access.value.token, given))
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
