import { AppInstallationStore } from "./app-installation-store.mjs";
import { PlanCatalog } from "./catalog.mjs";
import { ShopifyHooks } from "./hooks.mjs";
import { PartnerApi, PartnerApiOptions } from "./partner-api.mjs";
import { ShopifyClient } from "./shopify-client.mjs";
import { ShopGrantors } from "./shop-grantor.mjs";
import { ShopifyMerchant } from "./shopify.mjs";
import { SubscriptionPlan } from "./subscription-plan.mjs";
import { MerchantGate } from "./merchant-gate.mjs";
import { ExtraTopics, Webhooks } from "./webhooks.mjs";
import * as Layer from "effect/Layer";
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
/**
 * `ShopifyApp.define({ catalog, topics: { "orders/create": handler } })`. A topic the package
 * answers itself is a type error and, should a widened record slip one past the type, a throw at
 * the app's load: a shadowed built-in would silently drop the package's handling.
 */
declare const define: <Entry, R = never>(definition: {
  readonly catalog: PlanCatalog<Entry>;
  readonly topics?: ExtraTopics<R>;
}) => ShopifyAppDefinition<Entry, R>;
/** The topics an app's subscriptions must name: the built-in ones and the app's extra ones. */
declare const topicsOf: (app: ShopifyAppDefinition<unknown, unknown>) => readonly string[];
/**
 * `SubscriptionPlan`, `MerchantGate` and `Webhooks` over `app`, before their requirements: tier
 * 1's internals (which `ShopifyAccess`'s layers provide), the app's `ShopifyHooks`, a
 * `PartnerApi` and what `app`'s topic handlers need. Tests build it over `PartnerFake`.
 */
declare const layerNoDeps: <Entry, R>(app: ShopifyAppDefinition<Entry, R>) => Layer.Layer<MerchantGate | SubscriptionPlan | Webhooks, never, AppInstallationStore | PartnerApi | ShopGrantors | ShopifyClient | ShopifyHooks | ShopifyMerchant | Exclude<Exclude<R, import("effect/Scope").Scope>, SubscriptionPlan>>;
/** {@link layerNoDeps} over the Partner API with the app's `handle` and `partner` credentials, over `fetch`. */
declare const layer: <Entry, R>(app: ShopifyAppDefinition<Entry, R>, options: PartnerApiOptions) => Layer.Layer<MerchantGate | SubscriptionPlan | Webhooks, never, AppInstallationStore | ShopGrantors | ShopifyClient | ShopifyHooks | ShopifyMerchant | Exclude<Exclude<Exclude<R, import("effect/Scope").Scope>, SubscriptionPlan>, PartnerApi>>;
/** {@link layerNoDeps} over the Partner API, its credentials read from the Backend's bindings. */
declare const layerConfig: <Entry, R>(app: ShopifyAppDefinition<Entry, R>) => Layer.Layer<MerchantGate | SubscriptionPlan | Webhooks, never, AppInstallationStore | ShopGrantors | ShopifyClient | ShopifyHooks | ShopifyMerchant | Exclude<Exclude<Exclude<R, import("effect/Scope").Scope>, SubscriptionPlan>, PartnerApi>>;
export declare const ShopifyApp: {
  define: typeof define;
  topicsOf: typeof topicsOf;
  layerNoDeps: typeof layerNoDeps;
  layer: typeof layer;
  layerConfig: typeof layerConfig;
};
export {};