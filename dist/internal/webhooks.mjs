import { ShopifyHooks, bestEffort } from "./hooks.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { ShopifyClient } from "./shopify-client.mjs";
import { ShopGrantors } from "./shop-grantor.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Data from "effect/Data";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Predicate from "effect/Predicate";
// src/internal/webhooks.ts
/**
* `Webhooks`: Shopify's webhooks, verified by HMAC, dispatched by the `X-Shopify-Topic` header
* and answered by one table. The package answers its built-in topics; an app adds its own in its
* definition, and its handlers never choose an HTTP status.
*
* @module
*/
/**
* A verified delivery's payload did not decode. Answered 400 at Warning: a malformed payload does
* not improve on redelivery, so a 5xx would only burn Shopify's retries.
*/
var MalformedWebhookError = class extends Data.TaggedError("MalformedWebhookError") {
	get message() {
		return `The ${this.topic} payload does not decode`;
	}
};
/** Decodes a delivery's payload with `schema`, failing {@link MalformedWebhookError}. */
const decodePayload = (schema) => (delivery) => Schema.decodeUnknownEffect(schema)(delivery.payload).pipe(Effect.mapError(() => new MalformedWebhookError({ topic: delivery.topic })));
/** The `app/scopes_update` payload: the scopes the shop now grants. */
const ScopesUpdatePayload = Schema.Struct({ current: Schema.Array(Schema.String) });
/**
* How a delivery whose handler failed is answered and logged (`shopify-auth.md` Webhooks). It is
* answered non-2xx only when redelivery can succeed on its own: Shopify's retries end within
* hours, and failures that persist can remove the subscription. One answered 200 without acting
* relies on the app's reconciliation once access returns.
*/
const FAILURE_ANSWERS = {
	ShopifyUnavailableError: {
		status: 503,
		log: "Warn"
	},
	ReauthenticationRequiredError: {
		status: 200,
		log: "Warn"
	},
	AccessDeniedError: {
		status: 200,
		log: "Warn"
	},
	ShopInaccessibleError: {
		status: 200,
		log: "Warn"
	},
	AppNotInstalledError: {
		status: 200,
		log: "Debug"
	},
	MalformedWebhookError: {
		status: 400,
		log: "Warn"
	}
};
const isAnsweredFailure = (error) => Predicate.hasProperty(error, "_tag") && typeof error._tag === "string" && Object.hasOwn(FAILURE_ANSWERS, error._tag);
/** A failure's fields for its log line, beyond its tag and the delivery's shop. */
const failureFields = (failure) => failure._tag === "ReauthenticationRequiredError" ? { refreshTokenState: failure.refreshTokenState } : failure._tag === "ShopInaccessibleError" ? { status: failure.status } : {};
const answer = (status) => HttpServerResponse.empty({ status });
const make = (extra) => Effect.gen(function* () {
	const client = yield* ShopifyClient;
	const installations = yield* AppInstallationStore;
	const grantors = yield* ShopGrantors;
	const hooks = yield* ShopifyHooks;
	const context = yield* Effect.context();
	/**
	* The GDPR/CPRA compliance topics, required for App Store review: verified no-ops. A bad HMAC
	* already answered 401, which is what the requirement asks of an invalid signature.
	* Uninstall erased the shop's data, and by the delayed `shop/redact` there is nothing left;
	* acting on a surviving row instead risks a shop reinstalled inside the 48-hour delay.
	* `customers/*` have nothing to act on while no app stores customer identity.
	*/
	const compliance = () => Effect.void;
	/** Rewrites the stored scope; a shop with no row is left without one. */
	const scopesUpdate = (delivery) => decodePayload(ScopesUpdatePayload)(delivery).pipe(Effect.flatMap(({ current }) => installations.updateScope(delivery.shop, current.join(","))));
	const builtIn = {
		"customers/data_request": compliance,
		"customers/redact": compliance,
		"shop/redact": compliance,
		"app/scopes_update": scopesUpdate,
		"app/uninstalled": Effect.fn("Webhooks.appUninstalled")(function* ({ shop }) {
			yield* bestEffort("beforeUninstall", shop, hooks.beforeUninstall(shop));
			yield* grantors.uninstall(shop);
			yield* hooks.afterUninstall(shop);
			yield* Effect.logInfo(`Webhooks.appUninstalled: shop=${shop} status=uninstalled`).pipe(Effect.annotateLogs({
				shop,
				status: "uninstalled"
			}));
		})
	};
	const handlerOf = (topic) => {
		if (Object.hasOwn(builtIn, topic)) return builtIn[topic];
		if (!Object.hasOwn(extra, topic)) return void 0;
		const handler = extra[topic];
		return handler === void 0 ? void 0 : (delivery) => Effect.provideContext(handler(delivery), context);
	};
	/** One verified delivery to its answer. */
	const handle = Effect.fn("Webhooks.handle")(function* (delivery) {
		const { shop, topic } = delivery;
		const handler = handlerOf(topic);
		if (handler === void 0) {
			yield* Effect.logError(`Webhooks.handle: shop=${shop} topic=${topic}: no handler`);
			return answer(404);
		}
		yield* Effect.logDebug(`Webhooks.handle: shop=${shop} topic=${topic}`);
		return yield* handler(delivery).pipe(Effect.as(answer(200)), Effect.catchIf(isAnsweredFailure, (failure) => {
			const { status, log } = FAILURE_ANSWERS[failure._tag];
			const fields = failureFields(failure);
			const pairs = Object.entries(fields).map(([key, value]) => ` ${key}=${String(value)}`).join("");
			return Effect.logWithLevel(log)(`Webhooks.handle: shop=${shop} topic=${topic} error=${failure._tag}${pairs}`).pipe(Effect.annotateLogs({
				error: failure._tag,
				...fields
			}), Effect.as(answer(status)));
		}), Effect.catchCause((cause) => Effect.logError(`Webhooks.handle: shop=${shop} topic=${topic} status=failed`, cause).pipe(Effect.annotateLogs({ status: "failed" }), Effect.as(answer(500)))));
	});
	return { serve: Effect.fn("Webhooks.serve")(function* (request) {
		const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
		return yield* client.validateWebhook(web).pipe(Effect.flatMap((delivery) => handle(delivery).pipe(Effect.annotateLogs({
			shop: delivery.shop,
			topic: delivery.topic
		}))), Effect.catchTag("WebhookRejectedError", ({ status }) => Effect.succeed(answer(status))), Effect.catchCause((cause) => Effect.logError("Webhooks.serve: status=failed", cause).pipe(Effect.as(answer(500)))));
	}) };
});
/** Shopify's webhooks, served by the Backend under `/webhooks/`. The HMAC is the only credential. */
var Webhooks = class Webhooks extends Context.Service()("app/Webhooks") {
	/** Over the built-in topics and the app's `extra` ones. */
	static layer = (extra) => Layer.effect(Webhooks, make(extra));
};
export { MalformedWebhookError, Webhooks, decodePayload };
