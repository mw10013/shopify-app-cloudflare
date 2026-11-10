/**
 * The app's lifecycle hooks: behavior the package runs at fixed points of an uninstall and a plan
 * check. A service, not layer options, because a hook needs the app's own services (its shop
 * actors), which exist only above the layer that provides `Shopify`.
 *
 * @module
 */

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { AppSubscription } from "./catalog.ts";
import type { PlanHandle, ShopDomain, ShopGid } from "./domain.ts";

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

/** Every hook doing nothing; spread it to override one. */
const noop: ShopifyHooksShape = {
  beforeUninstall: () => Effect.void,
  afterUninstall: () => Effect.void,
  beforePlanChange: () => Effect.void,
  afterPlanRevalidated: () => Effect.void,
};

/**
 * A hook whose policy is best-effort: a failure or defect is logged at Warning, with `shop`, and
 * swallowed. An interruption is not a hook's failure, so it propagates.
 */
export const bestEffort = (
  hook: Exclude<keyof ShopifyHooksShape, "afterUninstall">,
  shop: ShopDomain,
  run: Effect.Effect<void>,
) =>
  run.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning(`ShopifyHooks.${hook}: shop=${shop} status=failed`, cause).pipe(
            Effect.annotateLogs({ shop, hook, status: "failed" }),
          ),
    ),
  );

/** The app's hooks. An app with none provides {@link ShopifyHooks.layerNoop}. */
export class ShopifyHooks extends Context.Service<ShopifyHooks, ShopifyHooksShape>()(
  "app/ShopifyHooks",
) {
  static readonly noop = noop;
  static readonly layerNoop = Layer.succeed(ShopifyHooks, noop);
}
