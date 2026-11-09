import { AppInstallationRedacted, AppInstallationRedactedPage } from "./app-installation.mjs";
import { ShopDomain } from "./domain.mjs";
import { AppInstallationStore, RedactedPageInput } from "./app-installation-store.mjs";
import { ShopifyCredentials } from "./bindings.mjs";
import { ShopifyClient } from "./shopify-client.mjs";
import { ShopGrantors } from "./shop-grantor.mjs";
import { Shopify, ShopifyMerchant } from "./shopify.mjs";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SQL from "@alchemy.run/cloudflare/D1/SQL";
export interface AppInstallationsShape {
  /** The shop's installation with its tokens projected away in SQL, so no token reaches a page. */
  readonly find: (shop: ShopDomain) => Effect.Effect<Option.Option<AppInstallationRedacted>>;
  /** Every installed shop, in `shop` order: the orphan sweep's list. */
  readonly shops: () => Effect.Effect<readonly ShopDomain[]>;
  /** The installed shops a keyset page at a time, either way, as {@link find} projects them. */
  readonly page: (input: RedactedPageInput) => Effect.Effect<AppInstallationRedactedPage>;
}
declare const AppInstallations_base: Context.ServiceClass<AppInstallations, "app/AppInstallations", AppInstallationsShape>;
/**
 * The read side of the `AppInstallation` table as an app may see it: no token ever leaves the
 * package. Every write is the package's, by the column's owner.
 */
export declare class AppInstallations extends AppInstallations_base {}
/**
 * Tier 1 over the shop's `ShopGrantor` Durable Object and the app's D1 `database`. Building it in
 * the Backend's init binds the `ShopGrantor` class to the Worker, so the app never names it. It
 * also provides the internal services tier 2 builds on.
 */
declare const layer: <R>(options: {
  readonly database: SQL.D1DatabaseSource<never, R>;
  readonly credentials: ShopifyCredentials;
}) => Layer.Layer<AppInstallationStore | AppInstallations | ShopGrantors | Shopify | ShopifyClient | ShopifyMerchant, never, import("@alchemy.run/cloudflare").Worker>;
/**
 * {@link layer} with the credentials read from `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and
 * `SHOPIFY_APP_URL`, which the stack binds to the Backend.
 */
declare const layerConfig: <R>(options: {
  readonly database: SQL.D1DatabaseSource<never, R>;
}) => Layer.Layer<AppInstallationStore | AppInstallations | ShopGrantors | Shopify | ShopifyClient | ShopifyMerchant, import("effect/Config").ConfigError, import("@alchemy.run/cloudflare").Worker>;
export declare const ShopifyAccess: {
  layerNoDeps: Layer.Layer<AppInstallations | Shopify | ShopifyMerchant, never, AppInstallationStore | ShopGrantors | ShopifyClient>;
  layer: typeof layer;
  layerConfig: typeof layerConfig;
};
export {};