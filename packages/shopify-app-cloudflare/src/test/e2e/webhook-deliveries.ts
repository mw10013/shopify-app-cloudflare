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

export const deliveryAddress = (tunnel: string, uri: string, marker: string): URL => {
  const { origin } = new URL(tunnel);
  const address = new URL(origin);
  address.pathname = new URL(uri, origin).pathname;
  address.searchParams.set(E2E_WEBHOOK_MARKER_PARAM, marker);
  if (address.origin !== origin)
    throw new Error(`${uri} delivers to ${address.origin}, not the tunnel's ${origin}`);
  return address;
};

export interface ExpectedDelivery {
  readonly topic: string;
  readonly marker: string;
  readonly shop: string;
}

export const deliveriesOf = (
  deliveries: readonly E2eWebhookDelivery[],
  marker: string,
): readonly E2eWebhookDelivery[] => deliveries.filter((delivery) => delivery.marker === marker);

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

export const describeDeliveries = (deliveries: readonly E2eWebhookDelivery[]): string =>
  deliveries.length === 0
    ? "  (none recorded)"
    : deliveries
        .map(
          ({ receivedAt, topic, webhookId, shop, marker, status }) =>
            `  ${DateTime.formatIso(receivedAt)} topic=${String(topic)} webhookId=${String(webhookId)} shop=${String(shop)} marker=${String(marker)} status=${String(status)}`,
        )
        .join("\n");
