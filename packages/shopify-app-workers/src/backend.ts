/**
 * What runs inside an app's Backend Worker: authentication, billing and webhooks.
 *
 * @module
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ShopGrantor, ShopGrantorLive } from "#internal/shop-grantor.ts";

export * from "./contract.ts";
export { AppSubscription, PlanCatalog, PlanStatus } from "#internal/catalog.ts";
export { type PlanRevalidation, ShopifyHooks, type ShopifyHooksShape } from "#internal/hooks.ts";
export { SHOP_GRANTOR_PING } from "#internal/shop-grantor.ts";
export { ADMIN_API_VERSION, PARTNER_API_VERSION } from "#internal/versions.ts";

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
