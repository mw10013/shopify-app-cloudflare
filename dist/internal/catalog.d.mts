import { PlanHandle } from "./domain.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
/**
 * The plans an app sells, keyed by Partner Dashboard handle, each with the app's own entry
 * (`{ plan: "pro", entitlements }`). The package's services take a catalog of any entry type, so
 * none is generic over it; the app reads its entry back with {@link PlanCatalog.entry}.
 */
export interface PlanCatalog<Entry = unknown> {
  readonly handles: readonly [PlanHandle, ...PlanHandle[]];
  /** The app's entry for a handle {@link PlanCatalog.parse} answered. */
  readonly entry: (handle: PlanHandle) => Entry;
  /**
   * The handle when the catalog sells it; `None` for null, an empty string or a handle outside
   * the catalog. A stored handle outside it (after a catalog change, a rename or a rollback) is
   * therefore a cache miss, never a row that fails to decode.
   */
  readonly parse: (raw: string | null) => Option.Option<PlanHandle>;
}
/**
 * `PlanCatalog.make({ "baton-basic": { plan: "basic" }, "baton-pro": { plan: "pro" } })`. An
 * empty catalog, or an empty handle, is a misconfiguration, so `make` throws at the app's load.
 */
declare const make: <const Entries extends Readonly<Record<string, unknown>>>(entries: Entries) => PlanCatalog<Entries[keyof Entries]>;
export declare const PlanCatalog: {
  make: typeof make;
};
/**
 * What the shop's app subscription grants right now. A plan change on Shopify's pricing page
 * applies at once and lands on the revalidation the billing redirect forces.
 *
 * @see https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-subscription-charges#proration-logic
 */
export declare const PlanStatus: Schema.Union<readonly [Schema.TaggedStruct<"Subscribed", {
  readonly handle: Schema.brand<Schema.NonEmptyString, "PlanHandle">;
  /** The next app subscription boundary: cycle end, or trial end during a trial. */
  readonly boundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
}>, Schema.TaggedStruct<"Unsubscribed", {}>]>;
export type PlanStatus = typeof PlanStatus.Type;
/**
 * A resolved app subscription (Shopify's `AppSubscription`): the one catalog handle it carries
 * and the billing cycle it is in. `boundaryAt` collapses two Shopify fields that never coexist:
 * `currentBillingCycle.endTime`, and `trialEndsAt` during a trial, when `currentBillingCycle` is
 * null (measured 2026-10-18). Both are the next instant the subscription may change without any
 * notification, since App Pricing sends no webhooks.
 */
export declare const AppSubscription: Schema.Struct<{
  readonly handle: Schema.brand<Schema.NonEmptyString, "PlanHandle">;
  readonly boundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  /** `currentBillingCycle.startTime`; null during a trial, which has no cycle. */
  readonly cycleStartAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
}>;
export type AppSubscription = typeof AppSubscription.Type;
export {};