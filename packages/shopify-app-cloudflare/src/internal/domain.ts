/**
 * The brands every other module builds on: the shop, its Admin API id and a plan handle.
 *
 * @module
 */

import * as Schema from "effect/Schema";

/**
 * A shop, named by its myshopify domain: the key of an `AppInstallation` row and the name of the
 * shop's actor. The value also arrives in a URL path, which a route decodes through
 * this before it reaches a query or `getByName`, so it is held to the shape of a myshopify
 * domain, not merely to what Shopify sent. A field holding one is named `shop`.
 */
export const ShopDomain = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u),
).pipe(Schema.brand("ShopDomain"));
export type ShopDomain = typeof ShopDomain.Type;

/** The longest id the package stores: Shopify's GIDs are far shorter. */
export const ID_MAX_LENGTH = 128;

/**
 * The shop's Admin API global id (`gid://shopify/Shop/<n>`), fetched once on the first mint.
 * A field holding one is `shopGid`, never `id`.
 */
export const ShopGid = Schema.NonEmptyString.check(Schema.isMaxLength(ID_MAX_LENGTH)).pipe(
  Schema.brand("ShopGid"),
);
export type ShopGid = typeof ShopGid.Type;

/**
 * A plan handle from the Partner Dashboard (`baton-basic`). Decoding checks only that it is a
 * non-empty string: whether the app sells it is the catalog's question (`PlanCatalog.parse`), so
 * a handle outside the catalog is a cache miss, never a failure to decode.
 */
export const PlanHandle = Schema.NonEmptyString.pipe(Schema.brand("PlanHandle"));
export type PlanHandle = typeof PlanHandle.Type;
