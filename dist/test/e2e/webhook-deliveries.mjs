import { E2E_WEBHOOK_MARKER_PARAM } from "../../internal/e2e-status.mjs";
import * as DateTime from "effect/DateTime";
// src/test/e2e/webhook-deliveries.ts
/**
* The webhook spec's pure parts: where a trigger delivers, and whether the e2e webhook record shows
* that trigger's delivery, and only it, answered 200. Apart from the spec so unit tests reach them
* without Playwright.
*
* @module
*/
/** The shop every sample `shopify app webhook trigger` delivers names in `X-Shopify-Shop-Domain`. */
const SAMPLE_SHOP = "shop.myshopify.com";
/**
* The address a trigger delivers to: the subscription `uri`'s path on the tunnel, carrying
* `marker` as its {@link E2E_WEBHOOK_MARKER_PARAM}. A `uri` on an absolute origin is the app's
* released URL, so only its path is kept; a path that would name another host (`//other.example/x`)
* stays a path, and the address is refused unless it is on the tunnel's origin.
*/
const deliveryAddress = (tunnel, uri, marker) => {
	const { origin } = new URL(tunnel);
	const address = new URL(origin);
	address.pathname = new URL(uri, origin).pathname;
	address.searchParams.set(E2E_WEBHOOK_MARKER_PARAM, marker);
	if (address.origin !== origin) throw new Error(`${uri} delivers to ${address.origin}, not the tunnel's ${origin}`);
	return address;
};
/** The recorded deliveries of the trigger that sent `marker`. */
const deliveriesOf = (deliveries, marker) => deliveries.filter((delivery) => delivery.marker === marker);
/**
* What is wrong with the trigger's deliveries: empty when exactly one carries its marker, and that
* one names its topic and shop and was answered 200.
*/
const deliveryProblems = (deliveries, { topic, marker, shop }) => {
	const marked = deliveriesOf(deliveries, marker);
	const [delivery, ...more] = marked;
	if (delivery === void 0 || more.length > 0) return [`${String(marked.length)} deliveries carry the trigger's marker, not 1`];
	return [
		...delivery.topic === topic ? [] : [`its topic is ${String(delivery.topic)}, not ${topic}`],
		...delivery.shop === shop ? [] : [`its shop is ${String(delivery.shop)}, not ${shop}`],
		...delivery.status === 200 ? [] : [`it was answered ${String(delivery.status)}, not 200`]
	];
};
/** One line per recorded delivery, for a failed step's message: no payload, no secret. */
const describeDeliveries = (deliveries) => deliveries.length === 0 ? "  (none recorded)" : deliveries.map(({ receivedAt, topic, webhookId, shop, marker, status }) => `  ${DateTime.formatIso(receivedAt)} topic=${String(topic)} webhookId=${String(webhookId)} shop=${String(shop)} marker=${String(marker)} status=${String(status)}`).join("\n");
export { SAMPLE_SHOP, deliveriesOf, deliveryAddress, deliveryProblems, describeDeliveries };
