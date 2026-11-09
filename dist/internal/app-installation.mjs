import { ShopDomain, ShopGid } from "./domain.mjs";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
// src/internal/app-installation.ts
/**
* The `AppInstallation` row's schemas, apart from the store that reads them so `/contract` can
* export the redacted projection without loading D1: an app's Backend sends what
* `AppInstallations` answers across a binding, and its Website decodes it with the same schema.
*
* @module
*/
/** An instant as an `AppInstallation` column stores it: epoch milliseconds, null when unset. */
const StoredInstant = Schema.NullOr(Schema.DateTimeUtcFromMillis);
/**
* An `AppInstallation` row: the app installed on one shop, from the first token exchange until
* uninstall, with every column the package's migrations create. Apps add no column here; their
* per-shop data lives in their own tables, which cascade from this one. A row with a column a
* later migration added still decodes: the struct ignores a property it does not name, so the
* previous package version keeps reading the table after an expand.
*/
const AppInstallation = Schema.Struct({
	shop: ShopDomain,
	shopGid: ShopGid,
	scope: Schema.NullOr(Schema.String),
	accessToken: Schema.NullOr(Schema.String),
	accessTokenExpiresAt: StoredInstant,
	refreshToken: Schema.NullOr(Schema.String),
	refreshTokenExpiresAt: StoredInstant,
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
	* When the row was inserted: the shop's first token exchange, or its first after an uninstall
	* deleted the row. An exchange on an existing row leaves it. Null on a row inserted before the
	* column existed.
	*/
	installedAt: StoredInstant
});
/**
* An `AppInstallation` with its tokens replaced by whether each is present, as
* `AppInstallations.find` answers it. Its instants encode as epoch milliseconds.
*/
const AppInstallationRedacted = Schema.Struct({
	...Struct.omit(AppInstallation.fields, ["accessToken", "refreshToken"]),
	hasAccessToken: Schema.Boolean,
	hasRefreshToken: Schema.Boolean
});
/**
* A keyset page of {@link AppInstallationRedacted} rows on `shop`, as `AppInstallations.page`
* answers it: the cursors are the page's first and last shops, null on an empty page.
*/
const AppInstallationRedactedPage = Schema.Struct({
	appInstallations: Schema.Array(AppInstallationRedacted),
	limit: Schema.Int,
	startCursor: Schema.NullOr(ShopDomain),
	endCursor: Schema.NullOr(ShopDomain),
	hasPreviousPage: Schema.Boolean,
	hasNextPage: Schema.Boolean
});
export { AppInstallation, AppInstallationRedacted, AppInstallationRedactedPage };
