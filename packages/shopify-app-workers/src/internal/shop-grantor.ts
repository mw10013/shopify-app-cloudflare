/**
 * Roadmap step 2, unit 0 spike: a stub of the grantor Durable Object, declared in the package to
 * show Alchemy binds a class it finds outside the app. Unit 5 replaces the body with the grantor.
 *
 * @module
 */

// The library's runtime adapter, loaded from the package so the spike shows workerd accepts it
// here; unit 4's `ShopifyClient` is its real importer.
import "@shopify/shopify-api/adapters/web-api";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";

/** The stub's answer, fixed so the testbed's route can compare it. */
export const SHOP_GRANTOR_PING = "shop-grantor:pong";

export interface ShopGrantorShape {
  readonly ping: () => Effect.Effect<string>;
}

/** The class name is the Durable Object's identity on Cloudflare and must never change. */
export class ShopGrantor extends Cloudflare.DurableObject<ShopGrantor, ShopGrantorShape>()(
  "ShopGrantor",
) {}

export const ShopGrantorLive = ShopGrantor.make(
  Effect.succeed(
    Effect.succeed({ ping: () => Effect.succeed(SHOP_GRANTOR_PING) } satisfies ShopGrantorShape),
  ),
);
