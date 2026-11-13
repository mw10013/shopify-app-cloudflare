import * as Layer from "effect/Layer";

import type { PlanCatalog } from "./catalog.ts";
import { MerchantGate } from "./merchant-gate.ts";
import { PartnerApi, type PartnerApiOptions } from "./partner-api.ts";
import { SubscriptionPlan } from "./subscription-plan.ts";
import { BUILT_IN_TOPICS } from "./webhook-topics.ts";
import { type ExtraTopics, Webhooks } from "./webhooks.ts";

/**
 * The app as the package sees it, built once at module scope and imported by the Backend and its
 * tests: the one list of the app's plans and of its extra webhook topics. `expectTomlMatches`
 * reads the topics from this value, so the toml and the dispatch cannot drift. `R` is what the
 * topic handlers need, which becomes a requirement of the tier 2 layer.
 */
export interface ShopifyAppDefinition<Entry = unknown, R = never> {
  readonly catalog: PlanCatalog<Entry>;
  readonly topics: ExtraTopics<R>;
}

const builtIn: ReadonlySet<string> = new Set(BUILT_IN_TOPICS);

/**
 * `ShopifyApp.define({ catalog, topics: { "orders/create": handler } })`. A topic the package
 * answers itself is a type error and, should a widened record slip one past the type, a throw at
 * the app's load: a shadowed built-in would silently drop the package's handling.
 */
const define = <Entry, R = never>(definition: {
  readonly catalog: PlanCatalog<Entry>;
  readonly topics?: ExtraTopics<R>;
}): ShopifyAppDefinition<Entry, R> => {
  const topics = definition.topics ?? {};
  for (const topic of Object.keys(topics))
    if (builtIn.has(topic))
      throw new Error(`ShopifyApp.define: topic=${topic}: the package answers it`);
  return { catalog: definition.catalog, topics };
};

/** The topics an app's subscriptions must name: the built-in ones and the app's extra ones. */
const topicsOf = (app: ShopifyAppDefinition<unknown, unknown>): readonly string[] => [
  ...BUILT_IN_TOPICS,
  ...Object.keys(app.topics),
];

/**
 * `SubscriptionPlan`, `MerchantGate` and `Webhooks` over `app`, before their requirements: tier
 * 1's internals (which `ShopifyAccess`'s layers provide), the app's `ShopifyHooks`, a
 * `PartnerApi` and what `app`'s topic handlers need. Tests build it over `PartnerFake`.
 */
const layerNoDeps = <Entry, R>(app: ShopifyAppDefinition<Entry, R>) =>
  Layer.merge(MerchantGate.layer, Webhooks.layer(app.topics)).pipe(
    Layer.provideMerge(SubscriptionPlan.layer(app.catalog)),
  );

/** {@link layerNoDeps} over the Partner API with the app's `handle` and `partner` credentials, over `fetch`. */
const layer = <Entry, R>(app: ShopifyAppDefinition<Entry, R>, options: PartnerApiOptions) =>
  layerNoDeps(app).pipe(Layer.provide(PartnerApi.layer(options)));

/** {@link layerNoDeps} over the Partner API, its credentials read from the Backend's bindings. */
const layerConfig = <Entry, R>(app: ShopifyAppDefinition<Entry, R>) =>
  layerNoDeps(app).pipe(Layer.provide(PartnerApi.layerConfig));

export const ShopifyApp = { define, topicsOf, layerNoDeps, layer, layerConfig };
