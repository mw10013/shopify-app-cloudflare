import { PartnerApi } from "./partner-api.mjs";
import { SubscriptionPlan } from "./subscription-plan.mjs";
import { MerchantGate } from "./merchant-gate.mjs";
import { BUILT_IN_TOPICS } from "./webhook-topics.mjs";
import { Webhooks } from "./webhooks.mjs";
import * as Layer from "effect/Layer";
// src/internal/shopify-app.ts
/**
* Tier 2, `ShopifyApp`: the app's definition (its catalog and extra webhook topics) and the layer
* that builds billing, the merchant gate and webhooks over it. It needs tier 1, the app's
* `ShopifyHooks` and a `PartnerApi`, so it is built above the app's shop actors.
*
* @module
*/
const builtIn = new Set(BUILT_IN_TOPICS);
/**
* `ShopifyApp.define({ catalog, topics: { "orders/create": handler } })`. A topic the package
* answers itself is a type error and, should a widened record slip one past the type, a throw at
* the app's load: a shadowed built-in would silently drop the package's handling.
*/
const define = (definition) => {
	const topics = definition.topics ?? {};
	for (const topic of Object.keys(topics)) if (builtIn.has(topic)) throw new Error(`ShopifyApp.define: topic=${topic}: the package answers it`);
	return {
		catalog: definition.catalog,
		topics
	};
};
/** The topics an app's subscriptions must name: the built-in ones and the app's extra ones. */
const topicsOf = (app) => [...BUILT_IN_TOPICS, ...Object.keys(app.topics)];
/**
* `SubscriptionPlan`, `MerchantGate` and `Webhooks` over `app`, before their requirements: tier
* 1's internals (which `ShopifyAccess`'s layers provide), the app's `ShopifyHooks`, a
* `PartnerApi` and what `app`'s topic handlers need. Tests build it over `PartnerFake`.
*/
const layerNoDeps = (app) => Layer.merge(MerchantGate.layer, Webhooks.layer(app.topics)).pipe(Layer.provideMerge(SubscriptionPlan.layer(app.catalog)));
/** {@link layerNoDeps} over the Partner API with the app's `handle` and `partner` credentials, over `fetch`. */
const layer = (app, options) => layerNoDeps(app).pipe(Layer.provide(PartnerApi.layer(options)));
/** {@link layerNoDeps} over the Partner API, its credentials read from the Backend's bindings. */
const layerConfig = (app) => layerNoDeps(app).pipe(Layer.provide(PartnerApi.layerConfig));
const ShopifyApp = {
	define,
	topicsOf,
	layerNoDeps,
	layer,
	layerConfig
};
export { ShopifyApp };
