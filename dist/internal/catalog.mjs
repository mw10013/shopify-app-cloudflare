import { PlanHandle } from "./domain.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
// src/internal/catalog.ts
/**
* The app's plan catalog, which it passes as data, and what a shop's app subscription resolves
* to. Plan handles are an allowlist: the package reads every handle through the catalog.
*
* @module
*/
const decodeHandle = Schema.decodeUnknownOption(PlanHandle);
/**
* `PlanCatalog.make({ "baton-basic": { plan: "basic" }, "baton-pro": { plan: "pro" } })`. An
* empty catalog, or an empty handle, is a misconfiguration, so `make` throws at the app's load.
*/
const make = (entries) => {
	const byHandle = /* @__PURE__ */ new Map();
	for (const [raw, entry] of Object.entries(entries)) {
		if (Option.isNone(decodeHandle(raw))) throw new Error(`PlanCatalog.make: handle=${JSON.stringify(raw)}: not a plan handle`);
		byHandle.set(raw, entry);
	}
	const [first, ...rest] = [...byHandle.keys()];
	if (first === void 0) throw new Error("PlanCatalog.make: the catalog has no plan");
	return {
		handles: [first, ...rest],
		entry: (handle) => {
			const entry = byHandle.get(handle);
			if (entry === void 0) throw new Error(`PlanCatalog.entry: handle=${handle}: not in the catalog`);
			return entry;
		},
		parse: (raw) => raw !== null && byHandle.has(raw) ? decodeHandle(raw) : Option.none()
	};
};
const PlanCatalog = { make };
/**
* What the shop's app subscription grants right now. A plan change on Shopify's pricing page
* applies at once and lands on the revalidation the billing redirect forces.
*
* @see https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-subscription-charges#proration-logic
*/
const PlanStatus = Schema.Union([Schema.TaggedStruct("Subscribed", {
	handle: PlanHandle,
	/** The next app subscription boundary: cycle end, or trial end during a trial. */
	boundaryAt: Schema.NullOr(Schema.DateTimeUtcFromMillis)
}), Schema.TaggedStruct("Unsubscribed", {})]);
/**
* A resolved app subscription (Shopify's `AppSubscription`): the one catalog handle it carries
* and the billing cycle it is in. `boundaryAt` collapses two Shopify fields that never coexist:
* `currentBillingCycle.endTime`, and `trialEndsAt` during a trial, when `currentBillingCycle` is
* null (measured 2026-10-18). Both are the next instant the subscription may change without any
* notification, since App Pricing sends no webhooks.
*/
const AppSubscription = Schema.Struct({
	handle: PlanHandle,
	boundaryAt: Schema.NullOr(Schema.DateTimeUtcFromMillis),
	/** `currentBillingCycle.startTime`; null during a trial, which has no cycle. */
	cycleStartAt: Schema.NullOr(Schema.DateTimeUtcFromMillis)
});
export { AppSubscription, PlanCatalog, PlanStatus };
