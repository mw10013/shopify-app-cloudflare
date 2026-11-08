/**
 * The webhooks: Shopify signs and delivers each compliance topic and each of the app's
 * {@link E2eApp} `webhooks.topics` to the e2e server's tunnel (`shopify app webhook trigger`), and
 * the Backend answers each 200, so the HMAC check passed under the app's real secret and the
 * topic's handler ran. The CLI reports a remote delivery only as enqueued, so the spec reads the
 * answer from the e2e webhook record. Shopify's sample deliveries name `shop.myshopify.com`, so
 * no delivery touches the leased store. A bad signature's 401 is the package's required behavior
 * N26 and the testbed's integ suite, not this spec's.
 *
 * @module
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { COMPLIANCE_TOPICS } from "#internal/webhook-topics.ts";
import { readWebhooks } from "#test/toml-webhooks.ts";

import type { E2eApp } from "./app.ts";
import { expect, readWebhookDeliveries, test } from "./fixtures.ts";

/** Shopify delivers a triggered sample within seconds. */
const DELIVERY_TIMEOUT = 60_000;

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

test("Shopify's signed webhooks pass the HMAC check and reach their handlers", async ({ app }) => {
  test.setTimeout(10 * 60_000);
  const { apiVersion, subscriptions } = readWebhooks(readFileSync(app.webhooks.config, "utf8"));
  if (apiVersion === undefined)
    throw new Error(`${app.webhooks.config} has no [webhooks] api_version`);

  for (const topic of [...COMPLIANCE_TOPICS, ...app.webhooks.topics])
    await test.step(topic, async () => {
      const uri = subscriptions.find(({ topics }) => topics.includes(topic))?.uri;
      if (uri === undefined)
        throw new Error(`${app.webhooks.config} subscribes no uri to ${topic}`);
      // A uri on an absolute origin is the app's released URL; the tunnel serves its path.
      const address = new URL(new URL(uri, app.server.tunnel).pathname, app.server.tunnel).href;
      const before = await readWebhookDeliveries(app);
      const seen = new Set(before.deliveries.map(({ webhookId }) => webhookId));
      const fresh = async () =>
        (await readWebhookDeliveries(app)).deliveries.filter(
          (delivery) => delivery.topic === topic && !seen.has(delivery.webhookId),
        );

      const out = await triggerWebhook(app, topic, apiVersion, address);
      expect(JSON.parse(out), "the CLI enqueued the delivery").toMatchObject({
        status: "success",
        delivery: { topic, address },
      });
      await expect
        .poll(async () => (await fresh()).length, {
          message: `Shopify's ${topic} delivery reaching ${address} within ${String(DELIVERY_TIMEOUT / 1000)} s`,
          timeout: DELIVERY_TIMEOUT,
          intervals: [1000],
        })
        .toBeGreaterThan(0);
      const statuses = (await fresh()).map(({ status }) => status);
      expect(statuses, `the Backend's answers to ${topic}`).toEqual([200]);
    });
});
