/**
 * Tier 1, `ShopifyAccess`: `Shopify` and the read side of the `AppInstallation` table, which an
 * app's shop actor needs and so must exist below it. Tier 2 (billing, the
 * merchant gate and webhooks) builds on the internal services it also provides.
 *
 * @module
 */

import type * as SQL from "@alchemy.run/cloudflare/D1/SQL";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";

import { AppInstallationStore, type RedactedPageInput } from "./app-installation-store.ts";
import type { AppInstallationRedacted, AppInstallationRedactedPage } from "./app-installation.ts";
import { AppTokens } from "./app-tokens.ts";
import type { ShopifyCredentials } from "./bindings.ts";
import type { ShopDomain } from "./domain.ts";
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
 * over the `ShopifyClient`, `AppTokens` and `AppInstallationStore` in context.
 */
const layerNoDeps = Layer.merge(layerShopify, layerAppInstallations);

/**
 * Tier 1 over the app's D1 `database` and its `credentials`. It also provides the internal
 * services tier 2 builds on.
 */
const layer = <R>(options: {
  readonly database: SQL.D1DatabaseSource<never, R>;
  readonly credentials: ShopifyCredentials;
}) =>
  over(
    options.database,
    ShopifyClient.layer(options.credentials),
    AppTokens.layer({
      clientId: options.credentials.apiKey,
      key: options.credentials.appTokenKey,
      kid: options.credentials.appTokenKid,
    }),
  );

/**
 * {@link layer} with the credentials read from `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
 * `SHOPIFY_APP_URL`, `SHOPIFY_APP_TOKEN_KEY` and `SHOPIFY_APP_TOKEN_KID`, which the stack binds to
 * the Backend. A Worker without the token key, or with one that does not import, fails its
 * startup naming it.
 */
const layerConfig = <R>(options: { readonly database: SQL.D1DatabaseSource<never, R> }) =>
  over(options.database, ShopifyClient.layerConfig, AppTokens.layerConfig);

const over = <R, E2, R2, E3, R3>(
  database: SQL.D1DatabaseSource<never, R>,
  client: Layer.Layer<ShopifyClient, E2, R2>,
  tokens: Layer.Layer<AppTokens, E3, R3>,
) =>
  layerNoDeps.pipe(
    Layer.provideMerge(Layer.merge(client, tokens)),
    Layer.provideMerge(AppInstallationStore.layerD1(database)),
  );

export const ShopifyAccess = { layerNoDeps, layer, layerConfig };
