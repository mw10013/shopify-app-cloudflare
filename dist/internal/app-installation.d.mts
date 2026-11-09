import * as Schema from "effect/Schema";
/**
 * An `AppInstallation` row: the app installed on one shop, from the first token exchange until
 * uninstall, with every column the package's migrations create. Apps add no column here; their
 * per-shop data lives in their own tables, which cascade from this one. A row with a column a
 * later migration added still decodes: the struct ignores a property it does not name, so the
 * previous package version keeps reading the table after an expand.
 */
export declare const AppInstallation: Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  readonly scope: Schema.NullOr<Schema.String>;
  readonly accessToken: Schema.NullOr<Schema.String>;
  readonly accessTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly refreshToken: Schema.NullOr<Schema.String>;
  readonly refreshTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  /**
   * The cached plan handle. A plain string, not `PlanHandle`: every row decodes on the merchant
   * path, so a stored handle outside the catalog must read as a cache miss (`PlanCatalog.parse`),
   * never as a row that fails to decode. Null with a null deadline is never fetched; null under
   * a future deadline is a verified absence of any app subscription.
   */
  readonly planHandle: Schema.NullOr<Schema.String>;
  /** The instant the cached handle stops being fresh. */
  readonly planHandleExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  /**
   * The app subscription's boundary, cached beside the handle so a cache hit answers when it
   * expires without a second Partner call. Meaningful only while `planHandleExpiresAt` is ahead.
   */
  readonly planBoundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  /**
   * When the row was inserted: the shop's first token exchange, or its first after an uninstall
   * deleted the row. An exchange on an existing row leaves it. Null on a row inserted before the
   * column existed.
   */
  readonly installedAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
}>;
export type AppInstallation = typeof AppInstallation.Type;
/**
 * An `AppInstallation` with its tokens replaced by whether each is present, as
 * `AppInstallations.find` answers it. Its instants encode as epoch milliseconds.
 */
export declare const AppInstallationRedacted: Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  readonly scope: Schema.NullOr<Schema.String>;
  readonly accessTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly refreshTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly planHandle: Schema.NullOr<Schema.String>;
  readonly planHandleExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly planBoundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly installedAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly hasAccessToken: Schema.Boolean;
  readonly hasRefreshToken: Schema.Boolean;
}>;
export type AppInstallationRedacted = typeof AppInstallationRedacted.Type;
/**
 * A keyset page of {@link AppInstallationRedacted} rows on `shop`, as `AppInstallations.page`
 * answers it: the cursors are the page's first and last shops, null on an empty page.
 */
export declare const AppInstallationRedactedPage: Schema.Struct<{
  readonly appInstallations: Schema.$Array<Schema.Struct<{
    readonly shop: Schema.brand<Schema.String, "ShopDomain">;
    readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
    readonly scope: Schema.NullOr<Schema.String>;
    readonly accessTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
    readonly refreshTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
    readonly planHandle: Schema.NullOr<Schema.String>;
    readonly planHandleExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
    readonly planBoundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
    readonly installedAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
    readonly hasAccessToken: Schema.Boolean;
    readonly hasRefreshToken: Schema.Boolean;
  }>>;
  readonly limit: Schema.Int;
  readonly startCursor: Schema.NullOr<Schema.brand<Schema.String, "ShopDomain">>;
  readonly endCursor: Schema.NullOr<Schema.brand<Schema.String, "ShopDomain">>;
  readonly hasPreviousPage: Schema.Boolean;
  readonly hasNextPage: Schema.Boolean;
}>;
export type AppInstallationRedactedPage = typeof AppInstallationRedactedPage.Type;