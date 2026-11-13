import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AppInstallationStore } from "./app-installation-store.ts";
import type { AppInstallation } from "./app-installation.ts";
import type { AppSubscription, PlanCatalog, PlanStatus } from "./catalog.ts";
import type { ShopifyUnavailableError } from "./contract.ts";
import type { PlanHandle, ShopDomain, ShopGid } from "./domain.ts";
import { bestEffort, ShopifyHooks } from "./hooks.ts";
import { PartnerApi, type PartnerSubscription } from "./partner-api.ts";

/**
 * How long a cached plan stays fresh when no subscription boundary falls sooner: a ceiling on
 * ignorance, not a refresh interval. Plan changes arrive through the billing redirect's forced
 * revalidation and cycle rolls through the boundary clamp, so this governs only what Shopify
 * never announces (App Pricing sends no webhooks): a freeze on a declined card, an immediate
 * cancellation, an expiry. A day: shortening it buys back cents of free service and pays for
 * them by locking out a shop whose card just bounced, the only grace period there is.
 */
export const PLAN_HANDLE_MAX_AGE = Duration.days(1);

/**
 * Grace past a subscription boundary before a revalidation is trusted. Expiring exactly at the
 * boundary races Shopify's own transition and can read back the outgoing subscription for a
 * whole max age.
 */
export const PLAN_HANDLE_BOUNDARY_SKEW = Duration.minutes(5);

/**
 * How long the cache stays fresh after the merchant presses Manage plan. The billing redirect
 * back forces a revalidation; this bounds the redirect that is lost (a closed tab) to minutes, so
 * a merchant who just upgraded does not spend a day on the old plan.
 */
export const PLAN_HANDLE_MANAGE_WINDOW = Duration.minutes(15);

export const STALE_PLAN_CONCURRENCY = 4;

/**
 * The cache deadline for a revalidation at `now`: {@link PLAN_HANDLE_MAX_AGE}, clamped to the
 * subscription boundary plus {@link PLAN_HANDLE_BOUNDARY_SKEW}, since the subscription changes
 * there unannounced (a cycle rolls, a trial ends).
 */
export const planHandleExpiresAt = (
  now: DateTime.Utc,
  boundaryAt: DateTime.Utc | null,
): DateTime.Utc => {
  const maxAge = DateTime.addDuration(now, PLAN_HANDLE_MAX_AGE);
  if (boundaryAt === null) return maxAge;
  const settled = DateTime.addDuration(boundaryAt, PLAN_HANDLE_BOUNDARY_SKEW);
  return DateTime.isGreaterThan(settled, now) ? DateTime.min(maxAge, settled) : maxAge;
};

export const isPlanCacheFresh = (expiresAt: DateTime.Utc | null, now: DateTime.Utc) =>
  expiresAt !== null && DateTime.isLessThan(now, expiresAt);

/** What the plan check reads of an `AppInstallation` row. */
export type PlanCacheRow = Pick<
  AppInstallation,
  "shop" | "shopGid" | "planHandle" | "planHandleExpiresAt" | "planBoundaryAt"
>;

const UNSUBSCRIBED = { _tag: "Unsubscribed" } as const satisfies PlanStatus;

export const cachedStatus = (
  row: PlanCacheRow,
  now: DateTime.Utc,
  catalog: PlanCatalog,
): Option.Option<PlanStatus> => {
  if (!isPlanCacheFresh(row.planHandleExpiresAt, now)) return Option.none();
  if (row.planHandle === null) return Option.some(UNSUBSCRIBED);
  return Option.map(catalog.parse(row.planHandle), (handle): PlanStatus => ({
    _tag: "Subscribed",
    handle,
    boundaryAt: row.planBoundaryAt,
  }));
};

const neverFetched = (row: PlanCacheRow) =>
  row.planHandle === null && row.planHandleExpiresAt === null;

export interface SubscriptionPlanShape {
  /**
   * The shop's plan: the cache when fresh, the Partner API when not. A caller that has just read
   * the row passes it, so it is not read twice. No row is `Unsubscribed` with no Shopify call:
   * uninstall deleted it. A Partner API that could not answer is `ShopifyUnavailableError`,
   * never `Unsubscribed`, and leaves the cache as it was.
   */
  readonly resolve: (
    shop: ShopDomain | PlanCacheRow,
  ) => Effect.Effect<PlanStatus, ShopifyUnavailableError>;
  /**
   * Revalidates whatever the cache holds: the billing redirect, whose `plan_handle` announces a
   * change Shopify directs apps to confirm against the Partner API.
   */
  readonly refresh: (
    shop: ShopDomain | PlanCacheRow,
  ) => Effect.Effect<PlanStatus, ShopifyUnavailableError>;
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

const make = (catalog: PlanCatalog) =>
  Effect.gen(function* () {
    const installations = yield* AppInstallationStore;
    const partner = yield* PartnerApi;
    const hooks = yield* ShopifyHooks;

    /**
     * The one catalog handle among the subscription's items, or `None`. By matching, never by
     * position: a usage meter is an item of the same subscription. None and several are both no
     * answer, and both log: allowlist drift is worth seeing even when the answer is no plan.
     */
    const matchPlanHandle = Effect.fn("SubscriptionPlan.matchPlanHandle")(function* (
      shop: ShopDomain,
      shopGid: ShopGid,
      subscription: PartnerSubscription,
    ) {
      const handles = subscription.handles.flatMap((raw) => Option.toArray(catalog.parse(raw)));
      const [handle] = handles;
      if (handle !== undefined && handles.length === 1) return Option.some(handle);
      yield* Effect.logWarning(
        `SubscriptionPlan.matchPlanHandle: shop=${shop} matches=${String(handles.length)}: the app subscription carries no single catalog handle`,
      ).pipe(
        Effect.annotateLogs({
          shop,
          shopGid,
          matches: handles.length,
          handles: subscription.handles,
        }),
      );
      return Option.none<PlanHandle>();
    });

    const revalidate = Effect.fn("SubscriptionPlan.revalidate")(function* (row: PlanCacheRow) {
      const active = yield* partner.activeSubscription(row.shop, row.shopGid);
      const handle = Option.isSome(active)
        ? yield* matchPlanHandle(row.shop, row.shopGid, active.value)
        : Option.none<PlanHandle>();
      const next: AppSubscription | null =
        Option.isSome(active) && Option.isSome(handle)
          ? {
              handle: handle.value,
              boundaryAt: active.value.boundaryAt,
              cycleStartAt: active.value.cycleStartAt,
            }
          : null;
      yield* installations.updatePlan({
        shop: row.shop,
        planHandle: next?.handle ?? null,
        planHandleExpiresAt: planHandleExpiresAt(yield* DateTime.now, next?.boundaryAt ?? null),
        planBoundaryAt: next?.boundaryAt ?? null,
      });
      yield* Effect.logInfo(
        `SubscriptionPlan.revalidate: shop=${row.shop} handle=${next?.handle ?? "none"}`,
      ).pipe(Effect.annotateLogs({ shop: row.shop, handle: next?.handle ?? "none" }));
      yield* bestEffort(
        "afterPlanRevalidated",
        row.shop,
        hooks.afterPlanRevalidated({
          shop: row.shop,
          shopGid: row.shopGid,
          previous: Option.getOrNull(catalog.parse(row.planHandle)),
          next,
          changed: !neverFetched(row) && (next?.handle ?? null) !== row.planHandle,
        }),
      );
      return next === null
        ? UNSUBSCRIBED
        : ({ _tag: "Subscribed", handle: next.handle, boundaryAt: next.boundaryAt } as const);
    });

    const rowOf = (shop: ShopDomain | PlanCacheRow) =>
      typeof shop === "string"
        ? installations.find(shop)
        : Effect.succeed(Option.some<PlanCacheRow>(shop));

    const resolve = Effect.fn("SubscriptionPlan.resolve")(function* (
      shop: ShopDomain | PlanCacheRow,
    ) {
      const row = yield* rowOf(shop);
      if (Option.isNone(row)) return UNSUBSCRIBED;
      const cached = cachedStatus(row.value, yield* DateTime.now, catalog);
      return Option.isSome(cached) ? cached.value : yield* revalidate(row.value);
    });

    const refresh = Effect.fn("SubscriptionPlan.refresh")(function* (
      shop: ShopDomain | PlanCacheRow,
    ) {
      const row = yield* rowOf(shop);
      return Option.isNone(row) ? UNSUBSCRIBED : yield* revalidate(row.value);
    });

    const expectChange = Effect.fn("SubscriptionPlan.expectChange")(function* (shop: ShopDomain) {
      yield* installations.shortenPlanExpiry({
        shop,
        expiresAt: DateTime.addDuration(yield* DateTime.now, PLAN_HANDLE_MANAGE_WINDOW),
      });
      yield* bestEffort("beforePlanChange", shop, hooks.beforePlanChange(shop));
      yield* Effect.logInfo(`SubscriptionPlan.expectChange: shop=${shop} status=shortened`).pipe(
        Effect.annotateLogs({ shop, status: "shortened" }),
      );
    });

    const revalidateStalePlans = Effect.gen(function* () {
      const shops = yield* installations.listShopsWithStalePlan(yield* DateTime.now);
      const results = yield* Effect.forEach(
        shops,
        (shop) =>
          refresh(shop).pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.logWarning(
                `SubscriptionPlan.revalidateStalePlans: shop=${shop} status=failed`,
                cause,
              ).pipe(Effect.annotateLogs({ shop, status: "failed" }), Effect.as(false)),
            ),
          ),
        { concurrency: STALE_PLAN_CONCURRENCY },
      );
      const failed = results.filter((ok) => !ok).length;
      yield* Effect.logInfo(
        `SubscriptionPlan.revalidateStalePlans: shops=${String(shops.length)} failed=${String(failed)}`,
      ).pipe(Effect.annotateLogs({ shops: shops.length, failed }));
      return { shops: shops.length, failed };
    }).pipe(Effect.withSpan("SubscriptionPlan.revalidateStalePlans"));

    return {
      resolve,
      refresh,
      expectChange,
      revalidateStalePlans,
    } satisfies SubscriptionPlanShape;
  });

/**
 * The shop's plan, read through the app's catalog: a handle outside it is a cache miss
 * everywhere. Revalidation runs the app's `afterPlanRevalidated` every time, with `changed`
 * computed here, once.
 */
export class SubscriptionPlan extends Context.Service<SubscriptionPlan, SubscriptionPlanShape>()(
  "app/SubscriptionPlan",
) {
  /** Over the app's `catalog`, the store, the {@link PartnerApi} and the app's hooks. */
  static readonly layer = (catalog: PlanCatalog) => Layer.effect(SubscriptionPlan, make(catalog));
}
