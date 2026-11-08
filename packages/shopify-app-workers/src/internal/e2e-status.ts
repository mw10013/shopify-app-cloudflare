/**
 * What an app's e2e-only routes answer and the end-to-end spec pack reads: the Backend
 * state Shopify's admin does not show.
 *
 * @module
 */

import * as Schema from "effect/Schema";

import { ShopDomain } from "./domain.ts";

/**
 * A shop's `AppInstallation` row as the suite sees it: whether it exists, the cached plan handle
 * as stored (null when never fetched or verified absent) and when the row was inserted.
 */
export const E2eShopStatus = Schema.Struct({
  shop: ShopDomain,
  installed: Schema.Boolean,
  planHandle: Schema.NullOr(Schema.String),
  installedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type E2eShopStatus = typeof E2eShopStatus.Type;

/**
 * One request the Backend's `/webhooks/*` branch answered: its `X-Shopify-Topic` and
 * `X-Shopify-Webhook-Id` headers as sent (null when absent, unverified when the HMAC failed), the
 * HTTP status it was answered with and when.
 */
export const E2eWebhookDelivery = Schema.Struct({
  topic: Schema.NullOr(Schema.String),
  webhookId: Schema.NullOr(Schema.String),
  status: Schema.Int,
  receivedAt: Schema.DateTimeUtcFromString,
});
export type E2eWebhookDelivery = typeof E2eWebhookDelivery.Type;

/** The webhook requests the e2e server's Backend answered since it started, oldest first. */
export const E2eWebhookDeliveries = Schema.Struct({
  deliveries: Schema.Array(E2eWebhookDelivery),
});
export type E2eWebhookDeliveries = typeof E2eWebhookDeliveries.Type;
