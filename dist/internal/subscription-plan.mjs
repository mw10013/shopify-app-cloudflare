import { ShopifyHooks, bestEffort } from "./hooks.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { PartnerApi } from "./partner-api.mjs";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// src/internal/subscription-plan.ts
/**
* `SubscriptionPlan`: the shop's plan, from the `AppInstallation` row's plan cache when fresh and
* from the Partner API when not, read through the app's catalog.
*
* @module
*/
/**
* How long a cached plan stays fresh when no subscription boundary falls sooner: a ceiling on
* ignorance, not a refresh interval. Plan changes arrive through the billing redirect's forced
* revalidation and cycle rolls through the boundary clamp, so this governs only what Shopify
* never announces (App Pricing sends no webhooks): a freeze on a declined card, an immediate
* cancellation, an expiry. A day: shortening it buys back cents of free service and pays for
* them by locking out a shop whose card just bounced, the only grace period there is.
*/
const PLAN_HANDLE_MAX_AGE = Duration.days(1);
/**
* Grace past a subscription boundary before a revalidation is trusted. Expiring exactly at the
* boundary races Shopify's own transition and can read back the outgoing subscription for a
* whole max age.
*/
const PLAN_HANDLE_BOUNDARY_SKEW = Duration.minutes(5);
/**
* How long the cache stays fresh after the merchant presses Manage plan. The billing redirect
* back forces a revalidation; this bounds the redirect that is lost (a closed tab) to minutes, so
* a merchant who just upgraded does not spend a day on the old plan.
*/
const PLAN_HANDLE_MANAGE_WINDOW = Duration.minutes(15);
/**
* The cache deadline for a revalidation at `now`: {@link PLAN_HANDLE_MAX_AGE}, clamped to the
* subscription boundary plus {@link PLAN_HANDLE_BOUNDARY_SKEW}, since the subscription changes
* there unannounced (a cycle rolls, a trial ends). A boundary already past is ignored: honoring
* it would write a deadline behind `now` and send every request to the Partner API.
*/
const planHandleExpiresAt = (now, boundaryAt) => {
	const maxAge = DateTime.addDuration(now, PLAN_HANDLE_MAX_AGE);
	if (boundaryAt === null) return maxAge;
	const settled = DateTime.addDuration(boundaryAt, PLAN_HANDLE_BOUNDARY_SKEW);
	return DateTime.isGreaterThan(settled, now) ? DateTime.min(maxAge, settled) : maxAge;
};
const UNSUBSCRIBED = { _tag: "Unsubscribed" };
/**
* The cached status, or `None` when it cannot be trusted: never fetched, past its deadline, or a
* handle outside the catalog (the catalog moved, so Shopify is asked again). A null handle under
* a future deadline is a verified absence of any subscription.
*/
const cachedStatus = (row, now, catalog) => {
	if (row.planHandleExpiresAt === null || DateTime.isGreaterThanOrEqualTo(now, row.planHandleExpiresAt)) return Option.none();
	if (row.planHandle === null) return Option.some(UNSUBSCRIBED);
	return Option.map(catalog.parse(row.planHandle), (handle) => ({
		_tag: "Subscribed",
		handle,
		boundaryAt: row.planBoundaryAt
	}));
};
/** Whether the row's plan was never fetched: the first read of a shop is not a change. */
const neverFetched = (row) => row.planHandle === null && row.planHandleExpiresAt === null;
const make = (catalog) => Effect.gen(function* () {
	const installations = yield* AppInstallationStore;
	const partner = yield* PartnerApi;
	const hooks = yield* ShopifyHooks;
	/**
	* The one catalog handle among the subscription's items, or `None`. By matching, never by
	* position: a usage meter is an item of the same subscription. None and several are both no
	* answer, and both log: allowlist drift is worth seeing even when the answer is no plan.
	*/
	const matchPlanHandle = Effect.fn("SubscriptionPlan.matchPlanHandle")(function* (shop, shopGid, subscription) {
		const handles = subscription.handles.flatMap((raw) => Option.toArray(catalog.parse(raw)));
		const [handle] = handles;
		if (handle !== void 0 && handles.length === 1) return Option.some(handle);
		yield* Effect.logWarning(`SubscriptionPlan.matchPlanHandle: shop=${shop} matches=${String(handles.length)}: the app subscription carries no single catalog handle`).pipe(Effect.annotateLogs({
			shop,
			shopGid,
			matches: handles.length,
			handles: subscription.handles
		}));
		return Option.none();
	});
	const revalidate = Effect.fn("SubscriptionPlan.revalidate")(function* (row) {
		const active = yield* partner.activeSubscription(row.shop, row.shopGid);
		const handle = Option.isSome(active) ? yield* matchPlanHandle(row.shop, row.shopGid, active.value) : Option.none();
		const next = Option.isSome(active) && Option.isSome(handle) ? {
			handle: handle.value,
			boundaryAt: active.value.boundaryAt,
			cycleStartAt: active.value.cycleStartAt
		} : null;
		yield* installations.updatePlan({
			shop: row.shop,
			planHandle: next?.handle ?? null,
			planHandleExpiresAt: planHandleExpiresAt(yield* DateTime.now, next?.boundaryAt ?? null),
			planBoundaryAt: next?.boundaryAt ?? null
		});
		yield* Effect.logInfo(`SubscriptionPlan.revalidate: shop=${row.shop} handle=${next?.handle ?? "none"}`).pipe(Effect.annotateLogs({
			shop: row.shop,
			handle: next?.handle ?? "none"
		}));
		yield* bestEffort("afterPlanRevalidated", row.shop, hooks.afterPlanRevalidated({
			shop: row.shop,
			shopGid: row.shopGid,
			previous: Option.getOrNull(catalog.parse(row.planHandle)),
			next,
			changed: !neverFetched(row) && (next?.handle ?? null) !== row.planHandle
		}));
		return next === null ? UNSUBSCRIBED : {
			_tag: "Subscribed",
			handle: next.handle,
			boundaryAt: next.boundaryAt
		};
	});
	const rowOf = (shop) => typeof shop === "string" ? installations.find(shop) : Effect.succeed(Option.some(shop));
	const resolve = Effect.fn("SubscriptionPlan.resolve")(function* (shop) {
		const row = yield* rowOf(shop);
		if (Option.isNone(row)) return UNSUBSCRIBED;
		const cached = cachedStatus(row.value, yield* DateTime.now, catalog);
		return Option.isSome(cached) ? cached.value : yield* revalidate(row.value);
	});
	const refresh = Effect.fn("SubscriptionPlan.refresh")(function* (shop) {
		const row = yield* rowOf(shop);
		return Option.isNone(row) ? UNSUBSCRIBED : yield* revalidate(row.value);
	});
	return {
		resolve,
		refresh,
		expectChange: Effect.fn("SubscriptionPlan.expectChange")(function* (shop) {
			yield* installations.shortenPlanExpiry({
				shop,
				expiresAt: DateTime.addDuration(yield* DateTime.now, PLAN_HANDLE_MANAGE_WINDOW)
			});
			yield* bestEffort("beforePlanChange", shop, hooks.beforePlanChange(shop));
			yield* Effect.logInfo(`SubscriptionPlan.expectChange: shop=${shop} status=shortened`).pipe(Effect.annotateLogs({
				shop,
				status: "shortened"
			}));
		}),
		revalidateStalePlans: Effect.gen(function* () {
			const shops = yield* installations.listShopsWithStalePlan(yield* DateTime.now);
			const failed = (yield* Effect.forEach(shops, (shop) => refresh(shop).pipe(Effect.as(true), Effect.catchCause((cause) => Effect.logWarning(`SubscriptionPlan.revalidateStalePlans: shop=${shop} status=failed`, cause).pipe(Effect.annotateLogs({
				shop,
				status: "failed"
			}), Effect.as(false)))), { concurrency: 4 })).filter((ok) => !ok).length;
			yield* Effect.logInfo(`SubscriptionPlan.revalidateStalePlans: shops=${String(shops.length)} failed=${String(failed)}`).pipe(Effect.annotateLogs({
				shops: shops.length,
				failed
			}));
			return {
				shops: shops.length,
				failed
			};
		}).pipe(Effect.withSpan("SubscriptionPlan.revalidateStalePlans"))
	};
});
/**
* The shop's plan, read through the app's catalog: a handle outside it is a cache miss
* everywhere. Revalidation runs the app's `afterPlanRevalidated` every time, with `changed`
* computed here, once.
*/
var SubscriptionPlan = class SubscriptionPlan extends Context.Service()("app/SubscriptionPlan") {
	/** Over the app's `catalog`, the store, the {@link PartnerApi} and the app's hooks. */
	static layer = (catalog) => Layer.effect(SubscriptionPlan, make(catalog));
};
export { PLAN_HANDLE_BOUNDARY_SKEW, PLAN_HANDLE_MANAGE_WINDOW, PLAN_HANDLE_MAX_AGE, SubscriptionPlan, cachedStatus, planHandleExpiresAt };
