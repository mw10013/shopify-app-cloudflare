/**
 * What an app's e2e-only status route answers and the end-to-end spec pack reads: the Backend
 * state Shopify's admin does not show.
 *
 * @module
 */

import * as Schema from "effect/Schema";

import { ShopDomain } from "./domain.ts";

/**
 * A shop's `AppInstallation` row as the suite sees it: whether it exists, the cached plan handle
 * as stored (null when never fetched or verified absent) and when the row was inserted.
 */
export const E2eShopStatus = Schema.Struct({
  shop: ShopDomain,
  installed: Schema.Boolean,
  planHandle: Schema.NullOr(Schema.String),
  installedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type E2eShopStatus = typeof E2eShopStatus.Type;
