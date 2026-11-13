/**
 * The app the required behaviors run against: a two-plan catalog, unless a harness is given the
 * app's own, and one probe topic whose handler makes an Admin API call, so the webhook answer
 * table runs end to end against the Shopify fake.
 *
 * @module
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PlanCatalog } from "#internal/catalog.ts";
import { ShopifyApp, type ShopifyAppDefinition } from "#internal/shopify-app.ts";
import { Shopify } from "#internal/shopify.ts";
import type { TopicHandler } from "#internal/webhooks.ts";

/** The catalog a harness uses when it is given no app: the first handle is the fake's default. */
export const BEHAVIOR_CATALOG = PlanCatalog.make({ "behavior-basic": {}, "behavior-pro": {} });

/**
 * The probe topic. Not one of Shopify's, so it collides with no app's topic; a test Backend
 * that runs the required behaviors registers it beside the app's own.
 */
export const BEHAVIOR_PROBE_TOPIC = "behavior/probe";

const ShopId = Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) });

const probe: TopicHandler<Shopify> = (delivery) =>
  Effect.flatMap(Shopify, (shopify) =>
    shopify.adminGraphql(delivery.shop, ShopId, "query Probe { shop { id } }"),
  ).pipe(Effect.asVoid);

/** `app` with the probe topic added; by default the {@link BEHAVIOR_CATALOG} and no other topic. */
export const behaviorApp = (
  app: ShopifyAppDefinition = ShopifyApp.define({ catalog: BEHAVIOR_CATALOG }),
): ShopifyAppDefinition<unknown, Shopify> => {
  const topics: Record<string, TopicHandler<Shopify>> = Object.fromEntries([
    ...Object.entries(app.topics),
    [BEHAVIOR_PROBE_TOPIC, probe],
  ]);
  return ShopifyApp.define({ catalog: app.catalog, topics });
};
