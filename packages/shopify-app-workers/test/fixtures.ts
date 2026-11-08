/**
 * Fixed values the package's tests share: a shop, its id, and instants by epoch milliseconds.
 *
 * @module
 */

import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { ShopDomain, ShopGid } from "#internal/domain.ts";

export const shopDomain = Schema.decodeUnknownSync(ShopDomain);

export const SHOP = shopDomain("seed-shop.myshopify.com");

export const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/1");

/** The instant `millis` after the epoch: a test's fixed point in time, when only order matters. */
export const at = (millis: number): DateTime.Utc => DateTime.makeUnsafe(millis);

/** An instant as epoch ms, or null for null: what an assertion compares an instant by. */
export const millisOf = (instant: DateTime.Utc | null): number | null =>
  instant === null ? null : DateTime.toEpochMillis(instant);
