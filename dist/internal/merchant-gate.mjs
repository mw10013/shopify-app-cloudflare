import { AppNotInstalledError, PlanUnsubscribedError } from "./contract.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { ShopifyClient, unavailable } from "./shopify-client.mjs";
import { PartnerApi } from "./partner-api.mjs";
import { ShopifyMerchant } from "./shopify.mjs";
import { SubscriptionPlan } from "./subscription-plan.mjs";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// src/internal/merchant-gate.ts
/**
* `MerchantGate`: the one way to a merchant. Every caller that holds an ID token, the App Home
* guard, a screen read, the socket gate and the Manage plan press, goes through it, so none
* re-derives the token check or the plan check.
*
* @module
*/
/**
* Where an unsubscribed merchant goes, as an `/app`-relative href: the plan selection page, which
* `admin.shopify.com` serves and so cannot render in the app's frame; `/auth/exit-iframe` breaks
* out of it first.
*/
const planSelectionHref = (planSelectionUrl, shop) => `/auth/exit-iframe?exitIframe=${encodeURIComponent(planSelectionUrl)}&shop=${shop}`;
const make = Effect.gen(function* () {
	const client = yield* ShopifyClient;
	const merchant = yield* ShopifyMerchant;
	const installations = yield* AppInstallationStore;
	const plans = yield* SubscriptionPlan;
	const partner = yield* PartnerApi;
	const unsubscribed = (shop) => new PlanUnsubscribedError({ href: planSelectionHref(partner.planSelectionUrl(shop), shop) });
	const authenticateMerchant = Effect.fn("MerchantGate.authenticateMerchant")(function* (idToken, options = {}) {
		const { shop, shopGid, stored } = yield* merchant.authenticateMerchant(idToken);
		const row = Option.isSome(stored) ? stored : yield* installations.find(shop);
		if (Option.isNone(row)) return yield* unavailable("MerchantGate.authenticateMerchant", shop, "uninstalled");
		if ((yield* options.billingRedirect === true ? plans.refresh(row.value) : plans.resolve(row.value))._tag === "Unsubscribed") return yield* unsubscribed(shop);
		return {
			shop,
			shopGid,
			managePlanUrl: partner.planSelectionUrl(shop)
		};
	});
	/** The verified shop's row, never exchanged; no row is `AppNotInstalledError`. */
	const installedRow = Effect.fnUntraced(function* (idToken) {
		const { shop } = yield* client.decodeIdToken(idToken);
		const row = yield* installations.find(shop);
		if (Option.isNone(row)) return yield* new AppNotInstalledError({ shop });
		return row.value;
	});
	return {
		authenticateMerchant,
		subscribedShop: Effect.fn("MerchantGate.subscribedShop")(function* (idToken) {
			const row = yield* installedRow(idToken).pipe(Effect.catchTag("AppNotInstalledError", Effect.die));
			const status = yield* plans.resolve(row);
			if (status._tag === "Unsubscribed") return yield* unsubscribed(row.shop);
			return {
				shop: row.shop,
				handle: status.handle,
				installedAt: row.installedAt
			};
		}),
		verifiedShop: Effect.fn("MerchantGate.verifiedShop")(function* (idToken) {
			return (yield* client.decodeIdToken(idToken)).shop;
		}),
		merchantStanding: Effect.fn("MerchantGate.merchantStanding")(function* (idToken) {
			const row = yield* installedRow(idToken);
			return {
				shop: row.shop,
				shopGid: row.shopGid,
				status: yield* plans.resolve(row)
			};
		}),
		expectPlanChange: Effect.fn("MerchantGate.expectPlanChange")(function* (idToken) {
			const { shop } = yield* client.decodeIdToken(idToken);
			yield* plans.expectChange(shop);
		})
	};
});
/** The merchant gate, over tier 1's merchant path, the store, the plan check and the Partner API. */
var MerchantGate = class MerchantGate extends Context.Service()("app/MerchantGate") {
	static layer = Layer.effect(MerchantGate, make);
};
export { MerchantGate, planSelectionHref };
