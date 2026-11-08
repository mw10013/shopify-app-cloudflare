import { ShopDomain } from "./domain.mjs";
import * as Schema from "effect/Schema";
// src/internal/e2e-status.ts
/**
* What an app's e2e-only routes answer and the end-to-end spec pack reads: the Backend
* state Shopify's admin does not show.
*
* @module
*/
/**
* A shop's `AppInstallation` row as the suite sees it: whether it exists, the cached plan handle
* as stored (null when never fetched or verified absent) and when the row was inserted.
*/
const E2eShopStatus = Schema.Struct({
	shop: ShopDomain,
	installed: Schema.Boolean,
	planHandle: Schema.NullOr(Schema.String),
	installedAt: Schema.NullOr(Schema.DateTimeUtcFromString)
});
/**
* The query parameter the spec pack adds to each triggered delivery's address, a value unique to
* the trigger, so the spec tells its own delivery from any other: a real one Shopify sends, a late
* one from an earlier trigger, or a forged post. The Backend's webhook route dispatches by header
* and ignores the query; the e2e record keeps the value as `marker`.
*/
const E2E_WEBHOOK_MARKER_PARAM = "e2e_marker";
/**
* One request the Backend's `/webhooks/*` branch answered: its `X-Shopify-Topic`,
* `X-Shopify-Webhook-Id` and `X-Shopify-Shop-Domain` headers as sent (null when absent, unverified
* when the HMAC failed), its {@link E2E_WEBHOOK_MARKER_PARAM} (null when absent), the HTTP status it
* was answered with and when.
*/
const E2eWebhookDelivery = Schema.Struct({
	topic: Schema.NullOr(Schema.String),
	webhookId: Schema.NullOr(Schema.String),
	shop: Schema.NullOr(Schema.String),
	marker: Schema.NullOr(Schema.String),
	status: Schema.Int,
	receivedAt: Schema.DateTimeUtcFromString
});
/** The webhook requests the e2e server's Backend answered since it started, oldest first. */
const E2eWebhookDeliveries = Schema.Struct({ deliveries: Schema.Array(E2eWebhookDelivery) });
export { E2E_WEBHOOK_MARKER_PARAM, E2eShopStatus, E2eWebhookDeliveries, E2eWebhookDelivery };
