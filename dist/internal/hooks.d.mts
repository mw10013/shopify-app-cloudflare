import { PlanHandle, ShopDomain, ShopGid } from "./domain.mjs";
import { AppSubscription } from "./catalog.mjs";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
/** What a plan check learned, handed to {@link ShopifyHooksShape.afterPlanRevalidated}. */
export interface PlanRevalidation {
  readonly shop: ShopDomain;
  readonly shopGid: ShopGid;
  /** The catalog handle the cache held before; null when unsubscribed or never fetched. */
  readonly previous: PlanHandle | null;
  /** What the Partner API says now; null when unsubscribed. */
  readonly next: AppSubscription | null;
  /**
   * The handle differs from the cached one. False on a never-fetched row: the first read of a
   * shop is not a change. Computed once, by the package, so no app recomputes it.
   */
  readonly changed: boolean;
}
/**
 * Every hook is an `Effect<void>`: a hook's failure is a defect, and what a defect does is the
 * package's policy for that hook, not the hook's type. Only `afterUninstall` fails its caller:
 *
 * | Hook                   | A defect                                                          |
 * | ---------------------- | ----------------------------------------------------------------- |
 * | `beforeUninstall`      | logged at Warning and swallowed: the uninstall goes on            |
 * | `afterUninstall`       | fails the webhook (500), so Shopify redelivers the whole uninstall |
 * | `beforePlanChange`     | logged at Warning and swallowed: the deadline is already shortened |
 * | `afterPlanRevalidated` | logged at Warning and swallowed: the plan answer is right anyway  |
 */
export interface ShopifyHooksShape {
  /** On `app/uninstalled`, before the `AppInstallation` row goes. */
  readonly beforeUninstall: (shop: ShopDomain) => Effect.Effect<void>;
  /** On `app/uninstalled`, after the row and its cascade are gone. Idempotent: Shopify redelivers. */
  readonly afterUninstall: (shop: ShopDomain) => Effect.Effect<void>;
  /** On the Manage plan press, once the plan deadline is shortened. */
  readonly beforePlanChange: (shop: ShopDomain) => Effect.Effect<void>;
  /** After every Partner API read of the shop's plan, once the plan cache is written. */
  readonly afterPlanRevalidated: (revalidation: PlanRevalidation) => Effect.Effect<void>;
}
declare const ShopifyHooks_base: Context.ServiceClass<ShopifyHooks, "app/ShopifyHooks", ShopifyHooksShape>;
/** The app's hooks. An app with none provides {@link ShopifyHooks.layerNoop}. */
export declare class ShopifyHooks extends ShopifyHooks_base {
  static readonly noop: ShopifyHooksShape;
  static readonly layerNoop: Layer.Layer<ShopifyHooks, never, never>;
}
export {};