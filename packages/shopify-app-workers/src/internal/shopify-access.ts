/**
 * Tier 1, `ShopifyAccess`: `Shopify`, the read side of the `AppInstallation` table and the
 * grantor, which an app's shop actor needs and so must exist below it. Tier 2 (billing, the
 * merchant gate and webhooks) builds on the internal services it also provides.
 *
 * @module
 */

import type * as SQL from "@alchemy.run/cloudflare/D1/SQL";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";

import {
  type AppInstallationRedacted,
  type AppInstallationRedactedPage,
  AppInstallationStore,
  type RedactedPageInput,
} from "./app-installation-store.ts";
import type { ShopifyCredentials } from "./bindings.ts";
import type { ShopDomain } from "./domain.ts";
import { ShopGrantorLive, ShopGrantors } from "./shop-grantor.ts";
import { ShopifyClient } from "./shopify-client.ts";
import { layerShopify } from "./shopify.ts";

export interface AppInstallationsShape {
  /** The shop's installation with its tokens projected away in SQL, so no token reaches a page. */
  readonly find: (shop: ShopDomain) => Effect.Effect<Option.Option<AppInstallationRedacted>>;
  /** Every installed shop, in `shop` order: the orphan sweep's list. */
  readonly shops: () => Effect.Effect<readonly ShopDomain[]>;
  /** The installed shops a keyset page at a time, either way, as {@link find} projects them. */
  readonly page: (input: RedactedPageInput) => Effect.Effect<AppInstallationRedactedPage>;
}

/**
 * The read side of the `AppInstallation` table as an app may see it: no token ever leaves the
 * package. Every write is the package's, by the column's owner.
 */
export class AppInstallations extends Context.Service<AppInstallations, AppInstallationsShape>()(
  "app/AppInstallations",
) {}

const layerAppInstallations = Layer.effect(
  AppInstallations,
  Effect.map(AppInstallationStore, (store) => ({
    find: store.findRedacted,
    shops: store.shops,
    page: store.getRedactedPage,
  })),
);

/**
 * Tier 1's services before their backings: `Shopify`, the merchant path and `AppInstallations`,
 * over the `ShopifyClient`, `ShopGrantors` and `AppInstallationStore` in context. Tests build it
 * over in-memory grantors; {@link layer} builds it over the Durable Object.
 */
const layerNoDeps = Layer.merge(layerShopify, layerAppInstallations);

/**
 * Tier 1 over the shop's `ShopGrantor` Durable Object and the app's D1 `database`. Building it in
 * the Backend's init binds the `ShopGrantor` class to the Worker, so the app never names it. It
 * also provides the internal services tier 2 builds on.
 */
const layer = <R>(options: {
  readonly database: SQL.D1DatabaseSource<never, R>;
  readonly credentials: ShopifyCredentials;
}) => withGrantorObject(options.database, ShopifyClient.layer(options.credentials));

/**
 * {@link layer} with the credentials read from `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and
 * `SHOPIFY_APP_URL`, which the stack binds to the Backend.
 */
const layerConfig = <R>(options: { readonly database: SQL.D1DatabaseSource<never, R> }) =>
  withGrantorObject(options.database, ShopifyClient.layerConfig);

const withGrantorObject = <R, E2, R2>(
  database: SQL.D1DatabaseSource<never, R>,
  client: Layer.Layer<ShopifyClient, E2, R2>,
) =>
  layerNoDeps.pipe(
    Layer.provideMerge(ShopGrantors.layer.pipe(Layer.provide(ShopGrantorLive))),
    Layer.provideMerge(client),
    Layer.provideMerge(AppInstallationStore.layerD1(database)),
  );

export const ShopifyAccess = { layerNoDeps, layer, layerConfig };
