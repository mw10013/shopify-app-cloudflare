import * as Schema from "effect/Schema";
// src/internal/domain.ts
/**
* The brands every other module builds on: the shop, its Admin API id and a plan handle.
*
* @module
*/
/**
* A shop, named by its myshopify domain: the key of an `AppInstallation` row and the name of the
* shop's grantor and actor. The value also arrives in a URL path, which a route decodes through
* this before it reaches a query or `getByName`, so it is held to the shape of a myshopify
* domain, not merely to what Shopify sent. A field holding one is named `shop`.
*/
const ShopDomain = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u)).pipe(Schema.brand("ShopDomain"));
/** The longest id the package stores: Shopify's GIDs are far shorter. */
const ID_MAX_LENGTH = 128;
/**
* The shop's Admin API global id (`gid://shopify/Shop/<n>`), fetched once on the first exchange.
* A field holding one is `shopGid`, never `id`.
*/
const ShopGid = Schema.NonEmptyString.check(Schema.isMaxLength(128)).pipe(Schema.brand("ShopGid"));
/**
* A plan handle from the Partner Dashboard (`baton-basic`). Decoding checks only that it is a
* non-empty string: whether the app sells it is the catalog's question (`PlanCatalog.parse`), so
* a handle outside the catalog is a cache miss, never a failure to decode.
*/
const PlanHandle = Schema.NonEmptyString.pipe(Schema.brand("PlanHandle"));
export { ID_MAX_LENGTH, PlanHandle, ShopDomain, ShopGid };
