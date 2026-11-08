import * as Schema from "effect/Schema";
/**
 * A shop's `AppInstallation` row as the suite sees it: whether it exists, the cached plan handle
 * as stored (null when never fetched or verified absent) and when the row was inserted.
 */
export declare const E2eShopStatus: Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly installed: Schema.Boolean;
  readonly planHandle: Schema.NullOr<Schema.String>;
  readonly installedAt: Schema.NullOr<Schema.DateTimeUtcFromString>;
}>;
export type E2eShopStatus = typeof E2eShopStatus.Type;
/**
 * The query parameter the spec pack adds to each triggered delivery's address, a value unique to
 * the trigger, so the spec tells its own delivery from any other: a real one Shopify sends, a late
 * one from an earlier trigger, or a forged post. The Backend's webhook route dispatches by header
 * and ignores the query; the e2e record keeps the value as `marker`.
 */
export declare const E2E_WEBHOOK_MARKER_PARAM = "e2e_marker";
/**
 * One request the Backend's `/webhooks/*` branch answered: its `X-Shopify-Topic`,
 * `X-Shopify-Webhook-Id` and `X-Shopify-Shop-Domain` headers as sent (null when absent, unverified
 * when the HMAC failed), its {@link E2E_WEBHOOK_MARKER_PARAM} (null when absent), the HTTP status it
 * was answered with and when.
 */
export declare const E2eWebhookDelivery: Schema.Struct<{
  readonly topic: Schema.NullOr<Schema.String>;
  readonly webhookId: Schema.NullOr<Schema.String>;
  readonly shop: Schema.NullOr<Schema.String>;
  readonly marker: Schema.NullOr<Schema.String>;
  readonly status: Schema.Int;
  readonly receivedAt: Schema.DateTimeUtcFromString;
}>;
export type E2eWebhookDelivery = typeof E2eWebhookDelivery.Type;
/** The webhook requests the e2e server's Backend answered since it started, oldest first. */
export declare const E2eWebhookDeliveries: Schema.Struct<{
  readonly deliveries: Schema.$Array<Schema.Struct<{
    readonly topic: Schema.NullOr<Schema.String>;
    readonly webhookId: Schema.NullOr<Schema.String>;
    readonly shop: Schema.NullOr<Schema.String>;
    readonly marker: Schema.NullOr<Schema.String>;
    readonly status: Schema.Int;
    readonly receivedAt: Schema.DateTimeUtcFromString;
  }>>;
}>;
export type E2eWebhookDeliveries = typeof E2eWebhookDeliveries.Type;