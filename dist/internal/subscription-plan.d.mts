import { ShopifyUnavailableError } from "./contract.mjs";
import { AppInstallation } from "./app-installation.mjs";
import { ShopDomain } from "./domain.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { PlanCatalog, PlanStatus } from "./catalog.mjs";
import { ShopifyHooks } from "./hooks.mjs";
import { PartnerApi } from "./partner-api.mjs";
import * as Context from "effect/Context";
import "effect/DateTime";
import * as Duration from "effect/Duration";
import "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
/**
 * How long a cached plan stays fresh when no subscription boundary falls sooner: a ceiling on
 * ignorance, not a refresh interval. Plan changes arrive through the billing redirect's forced
 * revalidation and cycle rolls through the boundary clamp, so this governs only what Shopify
 * never announces (App Pricing sends no webhooks): a freeze on a declined card, an immediate
 * cancellation, an expiry. A day: shortening it buys back cents of free service and pays for
 * them by locking out a shop whose card just bounced, the only grace period there is.
 */
export declare const PLAN_HANDLE_MAX_AGE: Duration.Duration;
/**
 * Grace past a subscription boundary before a revalidation is trusted. Expiring exactly at the
 * boundary races Shopify's own transition and can read back the outgoing subscription for a
 * whole max age.
 */
export declare const PLAN_HANDLE_BOUNDARY_SKEW: Duration.Duration;
/**
 * How long the cache stays fresh after the merchant presses Manage plan. The billing redirect
 * back forces a revalidation; this bounds the redirect that is lost (a closed tab) to minutes, so
 * a merchant who just upgraded does not spend a day on the old plan.
 */
export declare const PLAN_HANDLE_MANAGE_WINDOW: Duration.Duration;
/** What the plan check reads of an `AppInstallation` row. */
export type PlanCacheRow = Pick<AppInstallation, "shop" | "shopGid" | "planHandle" | "planHandleExpiresAt" | "planBoundaryAt">;
export interface SubscriptionPlanShape {
  /**
   * The shop's plan: the cache when fresh, the Partner API when not. A caller that has just read
   * the row passes it, so it is not read twice. No row is `Unsubscribed` with no Shopify call:
   * uninstall deleted it. A Partner API that could not answer is `ShopifyUnavailableError`,
   * never `Unsubscribed`, and leaves the cache as it was.
   */
  readonly resolve: (shop: ShopDomain | PlanCacheRow) => Effect.Effect<PlanStatus, ShopifyUnavailableError>;
  /**
   * Revalidates whatever the cache holds: the billing redirect, whose `plan_handle` announces a
   * change Shopify directs apps to confirm against the Partner API.
   */
  readonly refresh: (shop: ShopDomain | PlanCacheRow) => Effect.Effect<PlanStatus, ShopifyUnavailableError>;
  /**
   * The Manage plan press: pulls the cache deadline forward to at most
   * {@link PLAN_HANDLE_MANAGE_WINDOW} (never back, never on a row never fetched), then runs the
   * app's `beforePlanChange`. Called as the button is pressed, since the merchant leaves for
   * `admin.shopify.com` and may never come back through the redirect.
   */
  readonly expectChange: (shop: ShopDomain) => Effect.Effect<void>;
  /**
   * The daily cron entry point: {@link refresh} for every shop whose cache is stale,
   * {@link STALE_PLAN_CONCURRENCY} at a time, so every installed shop re-reads its plan at least
   * daily whether or not anyone opens the app. A shop's failure is logged and does not stop the
   * others; the next day retries it. It never fails, so a cron handler's other jobs still run.
   */
  readonly revalidateStalePlans: Effect.Effect<{
    readonly shops: number;
    readonly failed: number;
  }>;
}
declare const SubscriptionPlan_base: Context.ServiceClass<SubscriptionPlan, "app/SubscriptionPlan", SubscriptionPlanShape>;
/**
 * The shop's plan, read through the app's catalog: a handle outside it is a cache miss
 * everywhere. Revalidation runs the app's `afterPlanRevalidated` every time, with `changed`
 * computed here, once.
 */
export declare class SubscriptionPlan extends SubscriptionPlan_base {
  /** Over the app's `catalog`, the store, the {@link PartnerApi} and the app's hooks. */
  static readonly layer: (catalog: PlanCatalog) => Layer.Layer<SubscriptionPlan, never, AppInstallationStore | PartnerApi | ShopifyHooks>;
}
export {};