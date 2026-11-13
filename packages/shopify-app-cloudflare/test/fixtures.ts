import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { ShopDomain, ShopGid } from "#internal/domain.ts";

export const shopDomain = Schema.decodeUnknownSync(ShopDomain);

export const SHOP = shopDomain("seed-shop.myshopify.com");

export const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/1");

export const at = (millis: number): DateTime.Utc => DateTime.makeUnsafe(millis);

export const millisOf = (instant: DateTime.Utc | null): number | null =>
  instant === null ? null : DateTime.toEpochMillis(instant);
