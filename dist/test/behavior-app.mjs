import { PlanCatalog } from "../internal/catalog.mjs";
import { Shopify } from "../internal/shopify.mjs";
import { ShopifyApp } from "../internal/shopify-app.mjs";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
// src/test/behavior-app.ts
/**
* The app the required behaviors run against: a two-plan catalog, unless a harness is given the
* app's own, and one probe topic whose handler makes an Admin API call, so the webhook answer
* table runs end to end against the Shopify fake.
*
* @module
*/
/** The catalog a harness uses when it is given no app: the first handle is the fake's default. */
const BEHAVIOR_CATALOG = PlanCatalog.make({
	"behavior-basic": {},
	"behavior-pro": {}
});
/**
* The probe topic. Not one of Shopify's, so it collides with no app's topic; a test Backend
* that runs the required behaviors registers it beside the app's own.
*/
const BEHAVIOR_PROBE_TOPIC = "behavior/probe";
const ShopId = Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) });
/** Reads the shop's id through `Shopify.adminGraphql`: whatever the fake answers, the table answers. */
const probe = (delivery) => Effect.flatMap(Shopify, (shopify) => shopify.adminGraphql(delivery.shop, ShopId, "query Probe { shop { id } }")).pipe(Effect.asVoid);
/** `app` with the probe topic added; by default the {@link BEHAVIOR_CATALOG} and no other topic. */
const behaviorApp = (app = ShopifyApp.define({ catalog: BEHAVIOR_CATALOG })) => {
	const topics = Object.fromEntries([...Object.entries(app.topics), [BEHAVIOR_PROBE_TOPIC, probe]]);
	return ShopifyApp.define({
		catalog: app.catalog,
		topics
	});
};
export { BEHAVIOR_CATALOG, BEHAVIOR_PROBE_TOPIC, behaviorApp };
