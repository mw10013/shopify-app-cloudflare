import { PlanCatalog } from "../internal/catalog.mjs";
import { Shopify } from "../internal/shopify.mjs";
import { ShopifyAppDefinition } from "../internal/shopify-app.mjs";
/** The catalog a harness uses when it is given no app: the first handle is the fake's default. */
export declare const BEHAVIOR_CATALOG: PlanCatalog<{} | {}>;
/**
 * The probe topic. Not one of Shopify's, so it collides with no app's topic; a test Backend
 * that runs the required behaviors registers it beside the app's own.
 */
export declare const BEHAVIOR_PROBE_TOPIC = "behavior/probe";
/** `app` with the probe topic added; by default the {@link BEHAVIOR_CATALOG} and no other topic. */
export declare const behaviorApp: (app?: ShopifyAppDefinition) => ShopifyAppDefinition<unknown, Shopify>;