import * as Schema from "effect/Schema";

import { AppInstallationRedacted } from "./app-installation.ts";
import { ID_MAX_LENGTH, PlanHandle, ShopDomain } from "./domain.ts";

/** The Shops list holds this many shops a page, either way. */
export const APP_INSTALLATIONS_PAGE_SIZE = 25;

/** The Shops list's search: text matched anywhere in the shop's domain. */
export const ShopSearch = Schema.NonEmptyString.check(Schema.isMaxLength(ID_MAX_LENGTH));
export type ShopSearch = typeof ShopSearch.Type;

/**
 * `appInstallationsPage`'s input: a keyset cursor on `shop` one way or the other, and the search.
 * With both cursors, `before` wins.
 */
export const AppInstallationsPageRequest = Schema.Struct({
  after: Schema.optional(ShopDomain),
  before: Schema.optional(ShopDomain),
  filter: Schema.optional(ShopSearch),
});
export type AppInstallationsPageRequest = typeof AppInstallationsPageRequest.Type;

/** `adminShop`'s and `refreshPlan`'s input. */
export const AdminShopRequest = Schema.Struct({ shop: ShopDomain });
export type AdminShopRequest = typeof AdminShopRequest.Type;

/**
 * Why the shop's cached plan reads the way it does. Finer than what the merchant path trusts,
 * which reads every state but `Subscribed` and `Unsubscribed` as a miss: "never fetched",
 * "past its deadline" and "a handle the catalog no longer sells" have different remedies, and
 * `Unrecognized` shows the stored handle the merchant path hides.
 */
export const CachedPlan = Schema.Union([
  Schema.TaggedStruct("NeverFetched", {}),
  Schema.TaggedStruct("Unsubscribed", {}),
  Schema.TaggedStruct("Subscribed", { handle: PlanHandle }),
  Schema.TaggedStruct("Stale", { handle: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("Unrecognized", { handle: Schema.String }),
]);
export type CachedPlan = typeof CachedPlan.Type;

/**
 * The shop page: the shop's redacted `AppInstallation` row, its cached plan judged at the read
 * and its `ShopActor` id; or `NotFound` when the shop has no row, which uninstall deletes.
 */
export const AdminShopData = Schema.Union([
  Schema.TaggedStruct("NotFound", {}),
  Schema.TaggedStruct("Found", {
    appInstallation: AppInstallationRedacted,
    plan: CachedPlan,
    shopActorId: Schema.String,
  }),
]);
export type AdminShopData = typeof AdminShopData.Type;
