import { AppNotInstalledError } from "./contract.mjs";
import { BACKGROUND_ACCESS_TOKEN_BUFFER, MERCHANT_ACCESS_TOKEN_BUFFER, freshToken } from "./admin-token.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { ShopifyClient, unavailable } from "./shopify-client.mjs";
import { ShopGrantors } from "./shop-grantor.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// src/internal/shopify.ts
/**
* `Shopify`, the background path and Admin API calls by shop, and `ShopifyMerchant`, the merchant
* path the merchant gate builds on. Each answers from the stored `AppInstallation` row when its
* token will do, and otherwise asks the shop's grantor.
*
* @module
*/
const make = Effect.gen(function* () {
	const client = yield* ShopifyClient;
	const grantors = yield* ShopGrantors;
	const installations = yield* AppInstallationStore;
	const authenticateMerchant = Effect.fn("ShopifyMerchant.authenticateMerchant")(function* (idToken) {
		const { shop, sub } = yield* client.decodeIdToken(idToken);
		const stored = yield* installations.find(shop);
		const now = yield* DateTime.now;
		if (Option.isSome(stored) && Option.isSome(freshToken(stored.value, now, MERCHANT_ACCESS_TOKEN_BUFFER))) return {
			shop,
			shopGid: stored.value.shopGid,
			stored
		};
		return {
			shop,
			shopGid: yield* grantors.exchange(shop, idToken, sub ?? null),
			stored
		};
	});
	/** `ensureSession`, passing over `rejected`, the token an Admin API call got 401 with. */
	const ensureWith = Effect.fn("Shopify.ensureSession")(function* (shop, rejected) {
		const row = yield* installations.find(shop);
		if (Option.isNone(row)) return yield* new AppNotInstalledError({ shop });
		const stored = freshToken(row.value, yield* DateTime.now, BACKGROUND_ACCESS_TOKEN_BUFFER);
		if (Option.isSome(stored) && stored.value.accessToken !== rejected) return stored.value;
		return yield* grantors.ensure(shop, rejected);
	});
	const ensureSession = (shop) => ensureWith(shop, null);
	return {
		shopify: {
			ensureSession,
			adminGraphql: Effect.fn("Shopify.adminGraphql")(function* (shop, schema, query, variables) {
				const call = (accessToken) => client.adminCall("Shopify.adminGraphql", shop, accessToken, query, variables);
				const first = yield* ensureSession(shop);
				const data = yield* call(first.accessToken).pipe(Effect.catchTag("AdminUnauthorizedError", () => Effect.flatMap(ensureWith(shop, first.accessToken), (second) => call(second.accessToken))), Effect.catchTag("AdminUnauthorizedError", () => unavailable("Shopify.adminGraphql", shop, "unauthorized-after-refresh")));
				return yield* Schema.decodeUnknownEffect(schema)(data).pipe(Effect.orDie);
			})
		},
		merchant: { authenticateMerchant }
	};
});
/**
* The shop's Shopify Admin API without a merchant: `ensureSession` for a token and `adminGraphql`
* for a call by shop. What an app's background work and webhook handlers use.
*/
var Shopify = class extends Context.Service()("app/Shopify") {};
/** The merchant path. Not exported from the package: the merchant gate is its one caller. */
var ShopifyMerchant = class extends Context.Service()("app/ShopifyMerchant") {};
/**
* {@link Shopify} and {@link ShopifyMerchant} over the {@link ShopifyClient}, {@link ShopGrantors}
* and {@link AppInstallationStore} in context.
*/
const layerShopify = Layer.effectContext(Effect.map(make, ({ shopify, merchant }) => Context.make(Shopify, shopify).pipe(Context.add(ShopifyMerchant, merchant))));
export { Shopify, ShopifyMerchant, layerShopify };
