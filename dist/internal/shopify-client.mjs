import { ShopDomain } from "./domain.mjs";
import { AccessDeniedError, InvalidIdTokenError, ShopInaccessibleError, ShopifyUnavailableError } from "./contract.mjs";
import { shopifyCredentialsConfig } from "./bindings.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, GraphqlQueryError, HttpMaxRetriesError, HttpRequestError, HttpResponseError, InvalidJwtError, LogSeverity, Session, WebhookValidationErrorReason, shopifyApi } from "@shopify/shopify-api";
import * as Data from "effect/Data";
import * as Formatter from "effect/Formatter";
// src/internal/shopify-client.ts
/**
* The Admin API answered 401 to the access token. Never leaves the Admin API call:
* `Shopify.adminGraphql` retries it once, and the first exchange's `shopGid` fetch fails
* `ShopifyUnavailableError`.
*/
var AdminUnauthorizedError = class extends Data.TaggedError("AdminUnauthorizedError") {};
/**
* `validateWebhook` refused the request: 405 for a method other than POST, 401 for a bad HMAC,
* 400 for anything else invalid (an empty body, a missing header, a shop domain that is not a
* {@link ShopDomain}, a body that is not JSON). The caller answers with `status` and nothing else.
*/
var WebhookRejectedError = class extends Data.TaggedError("WebhookRejectedError") {};
const decodeWebhookShop = Schema.decodeUnknownOption(ShopDomain);
const decodeWebhookPayload = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
/** The claims verified beyond the library's checks, as `decodeSessionToken` returns them. */
const IdTokenClaims = Schema.Struct({
	iss: Schema.URLFromString,
	dest: Schema.URLFromString,
	sub: Schema.optional(Schema.String)
});
const decodeIdTokenClaims = Schema.decodeUnknownOption(IdTokenClaims);
const decodeShop = Schema.decodeUnknownOption(ShopDomain);
/** The `extensions.code` of each GraphQL error in a 200 answer. */
const GraphqlErrorCodes = Schema.Struct({ errors: Schema.Struct({ graphQLErrors: Schema.Array(Schema.Struct({ extensions: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })) })) }) });
const decodeGraphqlErrorCodes = Schema.decodeUnknownOption(GraphqlErrorCodes);
/** Whether `status` is how the Admin API refuses the shop itself. */
const isInaccessibleStatus = (status) => status === 402 || status === 423 || status === 403;
/** A library call that may reject, its rejection kept as the failure. */
const tryShopify = (evaluate) => Effect.tryPromise({
	try: evaluate,
	catch: (cause) => cause
});
/**
* Logs `<span>: shop=<shop> status=unavailable reason=<reason>` at Warning, with the HTTP status
* and the cause's message annotated, then fails {@link ShopifyUnavailableError}, which never
* carries its cause: it crosses to the browser.
*/
const unavailable = (span, shop, reason, detail = {}) => Effect.logWarning(`${span}: shop=${shop} status=unavailable reason=${reason}`).pipe(Effect.annotateLogs({
	shop,
	status: "unavailable",
	reason,
	...detail.httpStatus === void 0 ? {} : { httpStatus: detail.httpStatus },
	...detail.cause === void 0 ? {} : { cause: detail.cause instanceof Error ? detail.cause.message : Formatter.format(detail.cause) }
}), Effect.andThen(Effect.fail(new ShopifyUnavailableError({ shop }))));
const make = (credentials) => Effect.gen(function* () {
	const library = yield* Effect.cached(Effect.sync(() => {
		const { host, protocol } = new URL(credentials.appUrl);
		return shopifyApi({
			apiKey: credentials.apiKey,
			apiSecretKey: Redacted.value(credentials.apiSecret),
			hostName: host,
			hostScheme: protocol === "http:" ? "http" : "https",
			apiVersion: ApiVersion.October26,
			isEmbeddedApp: true,
			future: {
				customerAddressDefaultFix: true,
				unstable_managedPricingSupport: true
			},
			logger: { level: LogSeverity.Warning }
		});
	}));
	/**
	* Verifies an ID token: signature, `exp`/`nbf` and `aud` (the library's
	* `decodeSessionToken`), then that the hostnames of `iss` and `dest` match, which the
	* library does not check. The one definition of a valid ID token: every check of one uses
	* it. Answers the shop (`dest`'s host) and `sub`, the staff member, for attribution.
	*/
	const decodeIdToken = Effect.fn("ShopifyClient.decodeIdToken")(function* (idToken) {
		const shopify = yield* library;
		const payload = yield* tryShopify(() => shopify.session.decodeSessionToken(idToken)).pipe(Effect.catch((error) => error instanceof InvalidJwtError ? Effect.fail(new InvalidIdTokenError()) : Effect.die(error)));
		const claims = decodeIdTokenClaims(payload);
		const shop = Option.flatMap(claims, ({ iss, dest }) => iss.hostname === dest.hostname ? decodeShop(dest.hostname) : Option.none());
		if (Option.isNone(shop) || Option.isNone(claims)) return yield* new InvalidIdTokenError();
		return {
			shop: shop.value,
			sub: claims.value.sub
		};
	});
	/**
	* Classifies a failed Admin API call. A 200 that carries GraphQL errors arrives as
	* `GraphqlQueryError`: `THROTTLED` and `INTERNAL_SERVER_ERROR` are transient, `ACCESS_DENIED`
	* is a scope the shop has not granted, and anything else means the query is wrong.
	*/
	const classifyAdminFailure = (span, shop, error) => {
		if (error instanceof GraphqlQueryError) {
			const codes = Option.match(decodeGraphqlErrorCodes(error.body), {
				onNone: () => [],
				onSome: ({ errors }) => errors.graphQLErrors.map((each) => each.extensions?.code)
			});
			const transient = codes.find((code) => code === "THROTTLED" || code === "INTERNAL_SERVER_ERROR");
			if (transient !== void 0) return unavailable(span, shop, transient);
			if (codes.includes("ACCESS_DENIED")) return Effect.fail(new AccessDeniedError({ shop }));
			return Effect.die(error);
		}
		if (error instanceof HttpResponseError) {
			const code = error.response.code;
			if (code === 401) return Effect.fail(new AdminUnauthorizedError({ shop }));
			if (isInaccessibleStatus(code)) return Effect.fail(new ShopInaccessibleError({
				shop,
				status: code
			}));
			if (code === 429 || code >= 500) return unavailable(span, shop, "retriable-status", {
				httpStatus: code,
				cause: error
			});
			return Effect.die(error);
		}
		if (error instanceof HttpRequestError || error instanceof HttpMaxRetriesError) return unavailable(span, shop, "no-response", { cause: error });
		return Effect.die(error);
	};
	return {
		library,
		decodeIdToken,
		adminCall: Effect.fnUntraced(function* (span, shop, accessToken, query, variables) {
			const shopify = yield* library;
			const session = new Session({
				id: shopify.session.getOfflineId(shop),
				shop,
				state: "",
				isOnline: false,
				accessToken
			});
			const client = new shopify.clients.Graphql({ session });
			const { data } = yield* tryShopify(() => client.request(query, { variables })).pipe(Effect.catch((error) => classifyAdminFailure(span, shop, error)));
			return data;
		}),
		validateWebhook: Effect.fn("ShopifyClient.validateWebhook")(function* (request) {
			if (request.method !== "POST") {
				yield* Effect.logDebug("ShopifyClient.validateWebhook: httpStatus=405: not a POST").pipe(Effect.annotateLogs({
					httpStatus: 405,
					url: request.url,
					method: request.method
				}));
				return yield* new WebhookRejectedError({ status: 405 });
			}
			const shopify = yield* library;
			const rawBody = yield* tryShopify(() => request.text()).pipe(Effect.orDie);
			const validation = yield* tryShopify(() => shopify.webhooks.validate({
				rawBody,
				rawRequest: request
			})).pipe(Effect.orDie);
			if (!validation.valid) {
				const invalidHmac = validation.reason === WebhookValidationErrorReason.InvalidHmac;
				const httpStatus = invalidHmac ? 401 : 400;
				yield* (invalidHmac ? Effect.logError : Effect.logDebug)(`ShopifyClient.validateWebhook: httpStatus=${String(httpStatus)} reason=${validation.reason}`).pipe(Effect.annotateLogs({
					...validation,
					httpStatus
				}));
				return yield* new WebhookRejectedError({ status: httpStatus });
			}
			const shop = decodeWebhookShop(validation.domain);
			const payload = decodeWebhookPayload(rawBody);
			if (Option.isNone(shop) || Option.isNone(payload)) {
				yield* Effect.logWarning(`ShopifyClient.validateWebhook: httpStatus=400: the ${Option.isNone(shop) ? "shop domain" : "body"} does not decode`).pipe(Effect.annotateLogs({
					httpStatus: 400,
					topic: validation.topic,
					domain: validation.domain
				}));
				return yield* new WebhookRejectedError({ status: 400 });
			}
			return {
				shop: shop.value,
				topic: request.headers.get("x-shopify-topic") ?? validation.topic,
				payload: payload.value,
				webhookId: validation.webhookId
			};
		})
	};
});
/**
* Whether this code runs in a Worker Alchemy built: its bundler folds the global to `true`. The
* same check as devkit's `isAlchemyRuntime`, which the package does not depend on at run time.
*/
const isAlchemyRuntime = () => globalThis.__ALCHEMY_RUNTIME__ === true;
/**
* The stateless `@shopify/shopify-api` adapter: the library instance, ID token and webhook
* verification, and one classified Admin API call with a given access token. It holds no token
* and decides nothing about one: the grantor grants through its `library`, and `Shopify` calls
* the Admin API through `adminCall` with the stored token.
*/
var ShopifyClient = class ShopifyClient extends Context.Service()("app/ShopifyClient") {
	/** Given the API key, API secret and app URL. */
	static layer = (credentials) => Layer.effect(ShopifyClient, make(credentials));
	/**
	* Over `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL`, which the stack binds to
	* the Backend. They are absent while the stack is planned, when nothing calls Shopify; a
	* running Worker without them is broken.
	*/
	static layerConfig = Layer.unwrap(Effect.gen(function* () {
		const { apiKey, apiSecret, appUrl } = yield* shopifyCredentialsConfig;
		if (isAlchemyRuntime() && (Option.isNone(apiKey) || Option.isNone(apiSecret) || Option.isNone(appUrl))) return yield* Effect.die(/* @__PURE__ */ new Error("the Shopify API key, secret and app URL are not bound"));
		return ShopifyClient.layer({
			apiKey: Option.getOrElse(apiKey, () => ""),
			apiSecret: Option.getOrElse(apiSecret, () => Redacted.make("")),
			appUrl: Option.getOrElse(appUrl, () => "")
		});
	}));
};
export { AdminUnauthorizedError, ShopifyClient, WebhookRejectedError, isAlchemyRuntime, tryShopify, unavailable };
