/**
 * What runs inside an app's Backend Worker: authentication, billing and webhooks.
 *
 * @module
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ShopGrantor, ShopGrantorLive } from "#internal/shop-grantor.ts";

/** The Admin API version the package pins. Each app's `[webhooks] api_version` equals it. */
export const ADMIN_API_VERSION = "2026-10";

export { SHOP_GRANTOR_PING } from "#internal/shop-grantor.ts";

/**
 * Roadmap step 2, unit 0 spike: a shop's stub grantor, reached through the Durable Object
 * namespace. Building {@link GrantorProbe.layer} in the Backend's init binds the `ShopGrantor`
 * class to the Worker, so the app never names it. Unit 5 replaces this with `ShopifyAccess`.
 */
export class GrantorProbe extends Context.Service<
  GrantorProbe,
  { readonly ping: (shop: string) => Effect.Effect<string> }
>()("@mw10013/shopify-app-workers/GrantorProbe") {
  static readonly layer = Layer.effect(
    GrantorProbe,
    Effect.gen(function* () {
      const grantors = yield* ShopGrantor;
      return { ping: (shop) => grantors.getByName(shop).ping() };
    }),
  ).pipe(Layer.provide(ShopGrantorLive));
}
