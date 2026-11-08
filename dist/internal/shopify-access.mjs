import { AppInstallationStore } from "./app-installation-store.mjs";
import { ShopifyClient } from "./shopify-client.mjs";
import { ShopGrantorLive, ShopGrantors } from "./shop-grantor.mjs";
import { layerShopify } from "./shopify.mjs";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// src/internal/shopify-access.ts
/**
* The read side of the `AppInstallation` table as an app may see it: no token ever leaves the
* package. Every write is the package's, by the column's owner.
*/
var AppInstallations = class extends Context.Service()("app/AppInstallations") {};
const layerAppInstallations = Layer.effect(AppInstallations, Effect.map(AppInstallationStore, (store) => ({
	find: store.findRedacted,
	shops: store.shops,
	page: store.getRedactedPage
})));
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
const layer = (options) => withGrantorObject(options.database, ShopifyClient.layer(options.credentials));
/**
* {@link layer} with the credentials read from `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and
* `SHOPIFY_APP_URL`, which the stack binds to the Backend.
*/
const layerConfig = (options) => withGrantorObject(options.database, ShopifyClient.layerConfig);
const withGrantorObject = (database, client) => layerNoDeps.pipe(Layer.provideMerge(ShopGrantors.layer.pipe(Layer.provide(ShopGrantorLive))), Layer.provideMerge(client), Layer.provideMerge(AppInstallationStore.layerD1(database)));
const ShopifyAccess = {
	layerNoDeps,
	layer,
	layerConfig
};
export { AppInstallations, ShopifyAccess };
