/**
 * The webhooks: Shopify signs and delivers each compliance topic and each of the app's
 * {@link E2eApp} `webhooks.topics` to the e2e server's tunnel (`shopify app webhook trigger`), and
 * the Backend answers each 200. The CLI reports a remote delivery only as enqueued, so the spec
 * reads the answer from the e2e webhook record. Each trigger's address carries a marker of its own,
 * and the step passes only on exactly one delivery with that marker, naming the topic and
 * Shopify's sample shop and answered 200: never on a real delivery, a late one from an earlier
 * trigger or a forged post. A 200 proves the HMAC passed under the app's real secret and the topic
 * dispatched to a handler (a bad HMAC answers 401, an unknown topic 404). It proves the handler
 * succeeded only where its failures cannot answer 200: the compliance topics' handlers are no-ops,
 * and the app's `topics` are ones whose handlers only log. Shopify's sample deliveries name
 * `shop.myshopify.com`, so no delivery touches the leased store. A bad signature's 401 is the
 * package's required behavior N26 and the testbed's integ suite, not this spec's.
 *
 * @module
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { COMPLIANCE_TOPICS } from "#internal/webhook-topics.ts";
import { readWebhooks } from "#test/toml-webhooks.ts";

import type { E2eApp } from "./app.ts";
import { expect, readWebhookDeliveries, test } from "./fixtures.ts";
import {
  deliveriesOf,
  deliveryAddress,
  deliveryProblems,
  describeDeliveries,
  SAMPLE_SHOP,
} from "./webhook-deliveries.ts";

const DELIVERY_TIMEOUT = 60_000;

const DUPLICATE_SETTLE = 5000;

const CLI_TIMEOUT = 60_000;

/**
 * Has Shopify deliver a sample of `topic`, signed with the app's client secret, which the CLI
 * reads from the app's config, never this process.
 */
const triggerWebhook = (app: E2eApp, topic: string, apiVersion: string, address: string) => {
  const args = [
    "app",
    "webhook",
    "trigger",
    "--path",
    path.dirname(app.webhooks.config),
    "--config",
    path.basename(app.webhooks.config),
    "--no-input",
    "--json",
    "--topic",
    topic,
    "--api-version",
    apiVersion,
    "--address",
    address,
  ];
  return new Promise<string>((resolve, reject) => {
    execFile("shopify", args, { timeout: CLI_TIMEOUT }, (error, out, err) => {
      if (error === null) resolve(out);
      else
        reject(
          new Error(
            `shopify app webhook trigger --topic ${topic} failed: ${error.message}\n${out}\n${err}`,
            {
              cause: error,
            },
          ),
        );
    });
  });
};

test("Shopify's signed webhooks pass the HMAC check and are answered 200", async ({ app }) => {
  test.setTimeout(10 * 60_000);
  const { apiVersion, subscriptions } = readWebhooks(readFileSync(app.webhooks.config, "utf8"));
  if (apiVersion === undefined)
    throw new Error(`${app.webhooks.config} has no [webhooks] api_version`);

  for (const topic of [...COMPLIANCE_TOPICS, ...app.webhooks.topics])
    await test.step(topic, async () => {
      const uri = subscriptions.find(({ topics }) => topics.includes(topic))?.uri;
      if (uri === undefined)
        throw new Error(`${app.webhooks.config} subscribes no uri to ${topic}`);
      const expected = { topic, marker: randomUUID(), shop: SAMPLE_SHOP };
      const address = deliveryAddress(app.server.tunnel, uri, expected.marker).href;
      const recorded = async () => (await readWebhookDeliveries(app)).deliveries;

      const out = await triggerWebhook(app, topic, apiVersion, address);
      expect(JSON.parse(out), "the CLI enqueued the delivery").toMatchObject({
        status: "success",
        delivery: { topic, address },
      });
      await expect
        .poll(async () => deliveriesOf(await recorded(), expected.marker).length, {
          message: `Shopify's ${topic} delivery reaching ${address} within ${String(DELIVERY_TIMEOUT / 1000)} s`,
          timeout: DELIVERY_TIMEOUT,
          intervals: [1000],
        })
        .toBeGreaterThan(0);
      // A duplicate delivery arrives within moments of the first.
      await sleep(DUPLICATE_SETTLE);
      const deliveries = await recorded();
      expect(
        deliveryProblems(deliveries, expected),
        `${topic}'s one delivery, marked ${expected.marker}, for ${SAMPLE_SHOP} and answered 200; the record:\n${describeDeliveries(deliveries)}`,
      ).toEqual([]);
    });
});
