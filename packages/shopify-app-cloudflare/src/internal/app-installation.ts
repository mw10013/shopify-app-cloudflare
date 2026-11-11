/**
 * The `AppInstallation` row's schemas, apart from the store that reads them so `/contract` can
 * export the redacted projection without loading D1: an app's Backend sends what
 * `AppInstallations` answers across a binding, and its Website decodes it with the same schema.
 *
 * @module
 */

import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { ShopDomain, ShopGid } from "./domain.ts";

/** An instant as an `AppInstallation` column stores it: epoch milliseconds, null when unset. */
const StoredInstant = Schema.NullOr(Schema.DateTimeUtcFromMillis);

/**
 * An `AppInstallation` row: the app installed on one shop, from the first mint until
 * uninstall, with every column the package's migrations create but the two refresh columns,
 * unused since the application-only grant and always null. Apps add no column here; their
 * per-shop data lives in their own tables, which cascade from this one. A row with a column a
 * later migration added still decodes: the struct ignores a property it does not name.
 */
export const AppInstallation = Schema.Struct({
  shop: ShopDomain,
  shopGid: ShopGid,
  scope: Schema.NullOr(Schema.String),
  accessToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: StoredInstant,
  /**
   * The cached plan handle. A plain string, not `PlanHandle`: every row decodes on the merchant
   * path, so a stored handle outside the catalog must read as a cache miss (`PlanCatalog.parse`),
   * never as a row that fails to decode. Null with a null deadline is never fetched; null under
   * a future deadline is a verified absence of any app subscription.
   */
  planHandle: Schema.NullOr(Schema.String),
  /** The instant the cached handle stops being fresh. */
  planHandleExpiresAt: StoredInstant,
  /**
   * The app subscription's boundary, cached beside the handle so a cache hit answers when it
   * expires without a second Partner call. Meaningful only while `planHandleExpiresAt` is ahead.
   */
  planBoundaryAt: StoredInstant,
  /**
   * When the row was inserted: the shop's first mint, or its first after an uninstall deleted the
   * row. A mint on an existing row leaves it. Null on a row inserted before the
   * column existed.
   */
  installedAt: StoredInstant,
});
export type AppInstallation = typeof AppInstallation.Type;

/**
 * An `AppInstallation` with its token replaced by whether it is present, as
 * `AppInstallations.find` answers it. Its instants encode as epoch milliseconds.
 */
export const AppInstallationRedacted = Schema.Struct({
  ...Struct.omit(AppInstallation.fields, ["accessToken"]),
  hasAccessToken: Schema.Boolean,
});
export type AppInstallationRedacted = typeof AppInstallationRedacted.Type;

/**
 * A keyset page of {@link AppInstallationRedacted} rows on `shop`, as `AppInstallations.page`
 * answers it: the cursors are the page's first and last shops, null on an empty page.
 */
export const AppInstallationRedactedPage = Schema.Struct({
  appInstallations: Schema.Array(AppInstallationRedacted),
  limit: Schema.Int,
  startCursor: Schema.NullOr(ShopDomain),
  endCursor: Schema.NullOr(ShopDomain),
  hasPreviousPage: Schema.Boolean,
  hasNextPage: Schema.Boolean,
});
export type AppInstallationRedactedPage = typeof AppInstallationRedactedPage.Type;
