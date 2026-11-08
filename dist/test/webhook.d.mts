import * as Effect from "effect/Effect";
/** What a delivery is signed with; the fake app's secret unless a real app's trigger passes its own. */
export interface WebhookSigning {
  readonly apiSecret?: string | undefined;
}
/**
 * The headers Shopify sends with a webhook delivery of `body`: the five the library requires
 * (HMAC, topic, shop domain, API version, webhook id) and `content-type`. The HMAC is Shopify's,
 * base64 HMAC-SHA256 of the exact body under the app's secret, by default the fake app's
 * ({@link FAKE_SHOPIFY_API_SECRET}); a test that proves a refusal drops or overwrites a header.
 * `topic` is the header's form, `app/uninstalled`.
 */
export declare const signWebhook: (topic: string, shop: string & import("effect/Brand").Brand<"ShopDomain">, body: string, options?: WebhookSigning | undefined) => Effect.Effect<Record<string, string>, never, never>;
/**
 * POSTs `payload` to `url` as Shopify delivers `topic` for `shop`, signed by {@link signWebhook}
 * unless `signed` is false; answers the response's status.
 */
export declare const deliverWebhook: (url: string, topic: string, shop: string & import("effect/Brand").Brand<"ShopDomain">, payload: unknown, options?: (WebhookSigning & {
  readonly signed?: boolean | undefined;
}) | undefined) => Effect.Effect<number, import("effect/http/HttpClientError").HttpClientError, never>;