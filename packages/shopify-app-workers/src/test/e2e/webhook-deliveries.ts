/**
 * The webhook spec's pure parts: where a trigger delivers, and whether the e2e webhook record shows
 * that trigger's delivery, and only it, answered 200. Apart from the spec so unit tests reach them
 * without Playwright.
 *
 * @module
 */

import * as DateTime from "effect/DateTime";

import { E2E_WEBHOOK_MARKER_PARAM, type E2eWebhookDelivery } from "#internal/e2e-status.ts";

/** The shop every sample `shopify app webhook trigger` delivers names in `X-Shopify-Shop-Domain`. */
export const SAMPLE_SHOP = "shop.myshopify.com";

/**
 * The address a trigger delivers to: the subscription `uri`'s path on the tunnel, carrying
 * `marker` as its {@link E2E_WEBHOOK_MARKER_PARAM}. A `uri` on an absolute origin is the app's
 * released URL, so only its path is kept; a path that would name another host (`//other.example/x`)
 * stays a path, and the address is refused unless it is on the tunnel's origin.
 */
export const deliveryAddress = (tunnel: string, uri: string, marker: string): URL => {
  const { origin } = new URL(tunnel);
  const address = new URL(origin);
  address.pathname = new URL(uri, origin).pathname;
  address.searchParams.set(E2E_WEBHOOK_MARKER_PARAM, marker);
  if (address.origin !== origin)
    throw new Error(`${uri} delivers to ${address.origin}, not the tunnel's ${origin}`);
  return address;
};

/** What one trigger expects of its delivery. */
export interface ExpectedDelivery {
  readonly topic: string;
  readonly marker: string;
  readonly shop: string;
}

/** The recorded deliveries of the trigger that sent `marker`. */
export const deliveriesOf = (
  deliveries: readonly E2eWebhookDelivery[],
  marker: string,
): readonly E2eWebhookDelivery[] => deliveries.filter((delivery) => delivery.marker === marker);

/**
 * What is wrong with the trigger's deliveries: empty when exactly one carries its marker, and that
 * one names its topic and shop and was answered 200.
 */
export const deliveryProblems = (
  deliveries: readonly E2eWebhookDelivery[],
  { topic, marker, shop }: ExpectedDelivery,
): readonly string[] => {
  const marked = deliveriesOf(deliveries, marker);
  const [delivery, ...more] = marked;
  if (delivery === undefined || more.length > 0)
    return [`${String(marked.length)} deliveries carry the trigger's marker, not 1`];
  return [
    ...(delivery.topic === topic ? [] : [`its topic is ${String(delivery.topic)}, not ${topic}`]),
    ...(delivery.shop === shop ? [] : [`its shop is ${String(delivery.shop)}, not ${shop}`]),
    ...(delivery.status === 200 ? [] : [`it was answered ${String(delivery.status)}, not 200`]),
  ];
};

/** One line per recorded delivery, for a failed step's message: no payload, no secret. */
export const describeDeliveries = (deliveries: readonly E2eWebhookDelivery[]): string =>
  deliveries.length === 0
    ? "  (none recorded)"
    : deliveries
        .map(
          ({ receivedAt, topic, webhookId, shop, marker, status }) =>
            `  ${DateTime.formatIso(receivedAt)} topic=${String(topic)} webhookId=${String(webhookId)} shop=${String(shop)} marker=${String(marker)} status=${String(status)}`,
        )
        .join("\n");
