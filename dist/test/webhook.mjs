import { ADMIN_API_VERSION } from "../internal/versions.mjs";
import "./fake-app.mjs";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
// src/test/webhook.ts
/**
* `signWebhook` and `deliverWebhook`: a webhook delivery as Shopify sends one.
*
* @module
*/
const encodeBase64 = Schema.encodeSync(Schema.Uint8ArrayFromBase64);
const encoder = new TextEncoder();
/**
* The headers Shopify sends with a webhook delivery of `body`: the five the library requires
* (HMAC, topic, shop domain, API version, webhook id) and `content-type`. The HMAC is Shopify's,
* base64 HMAC-SHA256 of the exact body under the app's secret, by default the fake app's
* ({@link FAKE_SHOPIFY_API_SECRET}); a test that proves a refusal drops or overwrites a header.
* `topic` is the header's form, `app/uninstalled`.
*/
const signWebhook = Effect.fn("ShopifyWebhook.signWebhook")(function* (topic, shop, body, options = {}) {
	const signature = yield* Effect.promise(async () => {
		const key = await crypto.subtle.importKey("raw", encoder.encode(options.apiSecret ?? "fake-api-secret"), {
			name: "HMAC",
			hash: "SHA-256"
		}, false, ["sign"]);
		return crypto.subtle.sign("HMAC", key, encoder.encode(body));
	});
	return {
		"content-type": "application/json",
		"x-shopify-hmac-sha256": encodeBase64(new Uint8Array(signature)),
		"x-shopify-topic": topic,
		"x-shopify-shop-domain": shop,
		"x-shopify-api-version": ADMIN_API_VERSION,
		"x-shopify-webhook-id": crypto.randomUUID()
	};
});
/**
* POSTs `payload` to `url` as Shopify delivers `topic` for `shop`, signed by {@link signWebhook}
* unless `signed` is false; answers the response's status.
*/
const deliverWebhook = Effect.fn("ShopifyWebhook.deliverWebhook")(function* (url, topic, shop, payload, options = {}) {
	const body = JSON.stringify(payload);
	const headers = yield* signWebhook(topic, shop, body, options);
	return (yield* HttpClient.execute(HttpClientRequest.post(url).pipe(HttpClientRequest.setHeaders(options.signed === false ? {
		...headers,
		"x-shopify-hmac-sha256": "unsigned"
	} : headers), HttpClientRequest.bodyText(body, "application/json")))).status;
}, Effect.provide(FetchHttpClient.layer));
export { deliverWebhook, signWebhook };
