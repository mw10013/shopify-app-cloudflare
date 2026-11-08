/**
 * The e2e status route: what the end-to-end suite reads of the Backend's state, which Shopify's
 * admin does not show. Only the `E2eBackend` Worker serves it, and only the `e2e` stage deploys that
 * Worker, so no other stage can answer it.
 *
 * @module
 */

import { AppInstallations, ShopDomain } from "@mw10013/shopify-app-workers/backend";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** `GET /api/e2e/status?shop=<shop>.myshopify.com`, which the Website forwards to the Backend. */
export const E2E_STATUS_PATH = "/api/e2e/status";

/**
 * A shop's `AppInstallation` row as the suite sees it: whether it exists, the cached plan handle
 * as stored (null when never fetched or verified absent) and when the row was inserted.
 */
export const E2eShopStatus = Schema.Struct({
  shop: ShopDomain,
  installed: Schema.Boolean,
  planHandle: Schema.NullOr(Schema.String),
  installedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type E2eShopStatus = typeof E2eShopStatus.Type;

const decodeShop = Schema.decodeUnknownOption(ShopDomain);
const encodeStatus = Schema.encodeEffect(E2eShopStatus);

/** The route's handler: `400` without a valid `shop`, else the shop's {@link E2eShopStatus}. */
export const e2eStatus = Effect.gen(function* () {
  const installations = yield* AppInstallations;
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "GET") return HttpServerResponse.empty({ status: 405 });
    const shop = decodeShop(new URL(request.url, "http://backend").searchParams.get("shop"));
    if (Option.isNone(shop))
      return HttpServerResponse.text("shop must be a <name>.myshopify.com domain", {
        status: 400,
      });
    const row = Option.match(yield* installations.find(shop.value), {
      onNone: () => ({ installed: false, planHandle: null, installedAt: null }),
      onSome: ({ planHandle, installedAt }) => ({ installed: true, planHandle, installedAt }),
    });
    const status = yield* encodeStatus({ shop: shop.value, ...row }).pipe(Effect.orDie);
    return HttpServerResponse.jsonUnsafe(status);
  });
});
