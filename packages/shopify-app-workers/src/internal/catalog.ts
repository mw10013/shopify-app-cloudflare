/**
 * The app's plan catalog, which it passes as data, and what a shop's app subscription resolves
 * to. Plan handles are an allowlist: the package reads every handle through the catalog.
 *
 * @module
 */

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { PlanHandle } from "./domain.ts";

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

const decodeHandle = Schema.decodeUnknownOption(PlanHandle);

/**
 * `PlanCatalog.make({ "baton-basic": { plan: "basic" }, "baton-pro": { plan: "pro" } })`. An
 * empty catalog, or an empty handle, is a misconfiguration, so `make` throws at the app's load.
 */
const make = <const Entries extends Readonly<Record<string, unknown>>>(
  entries: Entries,
): PlanCatalog<Entries[keyof Entries]> => {
  const byHandle = new Map<string, Entries[keyof Entries]>();
  for (const [raw, entry] of Object.entries(entries) as [string, Entries[keyof Entries]][]) {
    if (Option.isNone(decodeHandle(raw)))
      throw new Error(`PlanCatalog.make: handle=${JSON.stringify(raw)}: not a plan handle`);
    byHandle.set(raw, entry);
  }
  const handles = [...byHandle.keys()] as PlanHandle[];
  const [first, ...rest] = handles;
  if (first === undefined) throw new Error("PlanCatalog.make: the catalog has no plan");
  return {
    handles: [first, ...rest],
    entry: (handle) => {
      const entry = byHandle.get(handle);
      if (entry === undefined)
        throw new Error(`PlanCatalog.entry: handle=${handle}: not in the catalog`);
      return entry;
    },
    parse: (raw) =>
      raw !== null && byHandle.has(raw) ? decodeHandle(raw) : Option.none<PlanHandle>(),
  };
};

export const PlanCatalog = { make };

/**
 * What the shop's app subscription grants right now. A plan change on Shopify's pricing page
 * applies at once and lands on the revalidation the billing redirect forces.
 *
 * @see https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-subscription-charges#proration-logic
 */
export const PlanStatus = Schema.Union([
  Schema.TaggedStruct("Subscribed", {
    handle: PlanHandle,
    /** The next app subscription boundary: cycle end, or trial end during a trial. */
    boundaryAt: Schema.NullOr(Schema.DateTimeUtcFromMillis),
  }),
  Schema.TaggedStruct("Unsubscribed", {}),
]);
export type PlanStatus = typeof PlanStatus.Type;

/**
 * A resolved app subscription (Shopify's `AppSubscription`): the one catalog handle it carries
 * and the billing cycle it is in. `boundaryAt` collapses two Shopify fields that never coexist:
 * `currentBillingCycle.endTime`, and `trialEndsAt` during a trial, when `currentBillingCycle` is
 * null (measured 2026-10-18). Both are the next instant the subscription may change without any
 * notification, since App Pricing sends no webhooks.
 */
export const AppSubscription = Schema.Struct({
  handle: PlanHandle,
  boundaryAt: Schema.NullOr(Schema.DateTimeUtcFromMillis),
  /** `currentBillingCycle.startTime`; null during a trial, which has no cycle. */
  cycleStartAt: Schema.NullOr(Schema.DateTimeUtcFromMillis),
});
export type AppSubscription = typeof AppSubscription.Type;
