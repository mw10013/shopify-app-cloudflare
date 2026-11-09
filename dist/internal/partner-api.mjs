import { appHandleConfig, partnerConfig } from "./bindings.mjs";
import { isAlchemyRuntime, unavailable } from "./shopify-client.mjs";
import { PARTNER_API_VERSION } from "./versions.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Config from "effect/Config";
import * as Function from "effect/Function";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
// src/internal/partner-api.ts
/**
* `PartnerApi`: the Partner API, billing's one external seam. One query, the shop's app
* subscription, and the plan selection page's URL.
*
* @module
*/
/** Stand-ins while the stack is planned, when nothing calls the Partner API; they only decode. */
const PLANNING_HANDLE = "planning";
const PLANNING_CONFIG = {
	SHOPIFY_PARTNER_ORG_ID: "0",
	SHOPIFY_PARTNER_APP_ID: "0",
	SHOPIFY_PARTNER_API_TOKEN: Redacted.make("planning")
};
const ACTIVE_SUBSCRIPTION_QUERY = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    items {
      handle
    }
    currentBillingCycle {
      startTime
      endTime
    }
    trialEndsAt
  }
}`;
/**
* Every field past `items` is optional or nullable, so an answer that omits one still decodes:
* losing a shop's access because Shopify stopped sending a bookkeeping field would be the worst
* trade.
*/
const ActiveSubscriptionResponse = Schema.Struct({
	data: Schema.optional(Schema.Struct({ activeSubscription: Schema.NullOr(Schema.Struct({
		items: Schema.Array(Schema.Struct({ handle: Schema.NullOr(Schema.String) })),
		currentBillingCycle: Schema.optional(Schema.NullOr(Schema.Struct({
			startTime: Schema.optional(Schema.NullOr(Schema.String)),
			endTime: Schema.optional(Schema.NullOr(Schema.String))
		}))),
		trialEndsAt: Schema.optional(Schema.NullOr(Schema.String))
	})) })),
	errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String })))
});
const decodeInstant = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString);
/** An ISO instant, or null when absent or unreadable. */
const instantOrNull = (value) => Option.getOrNull(decodeInstant(value));
/**
* How long one attempt waits for the Partner API's whole response, its headers and its body, the
* same as a grant attempt's deadline (`GRANT_ATTEMPT_DEADLINE`): the merchant gate waits on this
* call. An attempt past it is abandoned and counts as transient, so it is retried, and once the
* retries are spent it is `ShopifyUnavailableError`. With the retries, a hung Partner API holds a
* page about 16.5 s.
*/
const PARTNER_ATTEMPT_DEADLINE = Duration.seconds(5);
/** The shop's plan selection page for the app whose handle is `handle`. */
const planSelectionUrlOf = (handle) => (shop) => `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/u, "")}/charges/${handle}/pricing_plans`;
const make = Effect.fnUntraced(function* ({ handle, partner: config }) {
	const endpoint = `https://partners.shopify.com/${config.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`;
	const appGid = `gid://shopify/App/${config.SHOPIFY_PARTNER_APP_ID}`;
	const client = (yield* HttpClient.HttpClient).pipe(HttpClient.mapRequest(Function.flow(HttpClientRequest.acceptJson, HttpClientRequest.setHeader("X-Shopify-Access-Token", Redacted.value(config.SHOPIFY_PARTNER_API_TOKEN)))), HttpClient.filterStatusOk, HttpClient.tap((response) => response.text), HttpClient.timeout(PARTNER_ATTEMPT_DEADLINE), HttpClient.retryTransient({
		schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
		times: 2
	}));
	return {
		activeSubscription: Effect.fn("PartnerApi.activeSubscription")(function* (shop, shopGid) {
			yield* Effect.annotateCurrentSpan({
				shop,
				shopGid
			});
			const { data, errors } = yield* HttpClientRequest.post(endpoint).pipe(HttpClientRequest.bodyJsonUnsafe({
				query: ACTIVE_SUBSCRIPTION_QUERY,
				variables: {
					appId: appGid,
					shopId: shopGid
				}
			}), client.execute, Effect.flatMap(HttpClientResponse.schemaBodyJson(ActiveSubscriptionResponse)), Effect.catchTag("SchemaError", Effect.die), Effect.catchTag("HttpClientError", (error) => HttpClient.isTransientError(error) ? unavailable("PartnerApi.activeSubscription", shop, error.reason._tag, {
				httpStatus: error.response?.status,
				cause: error
			}) : Effect.die(error)));
			if (errors !== void 0 && errors.length > 0) return yield* Effect.die(/* @__PURE__ */ new Error(`Partner API errors: ${errors.map((each) => each.message).join("; ")}`));
			if (data === void 0) return yield* Effect.die(/* @__PURE__ */ new Error("Partner API answered with neither data nor errors"));
			const subscription = data.activeSubscription;
			if (subscription === null) return Option.none();
			return Option.some({
				handles: subscription.items.flatMap(({ handle }) => handle === null || handle === "" ? [] : [handle]),
				boundaryAt: instantOrNull(subscription.currentBillingCycle?.endTime ?? subscription.trialEndsAt),
				cycleStartAt: instantOrNull(subscription.currentBillingCycle?.startTime)
			});
		}),
		planSelectionUrl: planSelectionUrlOf(handle)
	};
});
/**
* {@link PartnerApi} over `config` and the `HttpClient` in context, which a test scripts. Not
* exported from the package, so no transport type reaches an app.
*/
const layerHttpClient = (options) => Layer.effect(PartnerApi, make(options));
/** The Partner API. `/test`'s `PartnerFake` provides it in tests. */
var PartnerApi = class PartnerApi extends Context.Service()("app/PartnerApi") {
	/** Over `options`, with `fetch`. */
	static layer = (options) => layerHttpClient(options).pipe(Layer.provide(FetchHttpClient.layer));
	/**
	* Over `SHOPIFY_APP_HANDLE`, which the stack binds with the app, and `SHOPIFY_PARTNER_ORG_ID`,
	* `SHOPIFY_PARTNER_APP_ID` and `SHOPIFY_PARTNER_API_TOKEN`, which it binds when the stage has
	* them, with `fetch`. All are absent while the stack is planned, when nothing calls the Partner
	* API. A running Worker without the credentials gets {@link PartnerApi.layerUnbound}.
	*/
	static layerConfig = Layer.unwrap(Effect.gen(function* () {
		const handle = yield* Config.option(appHandleConfig).pipe(Effect.orDie);
		const partner = yield* Config.option(partnerConfig).pipe(Effect.orDie);
		if (Option.isSome(handle) && Option.isSome(partner)) return PartnerApi.layer({
			handle: handle.value,
			partner: partner.value
		});
		if (isAlchemyRuntime()) return PartnerApi.layerUnbound(handle);
		return PartnerApi.layer({
			handle: PLANNING_HANDLE,
			partner: PLANNING_CONFIG
		});
	}));
	/**
	* The Partner API of a running Worker the stack bound no Partner credentials to (a dev stage
	* before the owner adds them to `.env`): `activeSubscription` is a defect that says why, so a
	* plan is never guessed from a missing credential. The plan selection page needs only the
	* app's `handle`, which is public, so a shop whose plan is cached still passes the gate; it too
	* is a defect when the handle is unbound. The Backend still boots, so webhooks and the grantor
	* work.
	*/
	static layerUnbound = (handle) => Layer.succeed(PartnerApi, PartnerApi.of({
		activeSubscription: () => Effect.die(/* @__PURE__ */ new Error("the Partner API credentials are not bound")),
		planSelectionUrl: Option.match(handle, {
			onNone: () => () => {
				throw new Error("the Shopify app handle is not bound");
			},
			onSome: planSelectionUrlOf
		})
	}));
};
export { PARTNER_ATTEMPT_DEADLINE, PartnerApi, layerHttpClient };
