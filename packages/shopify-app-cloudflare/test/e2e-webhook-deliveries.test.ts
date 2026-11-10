import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { E2E_WEBHOOK_MARKER_PARAM, type E2eWebhookDelivery } from "#internal/e2e-status.ts";
import {
  deliveriesOf,
  deliveryAddress,
  deliveryProblems,
  describeDeliveries,
  SAMPLE_SHOP,
} from "#test/e2e/webhook-deliveries.ts";

const TUNNEL = "https://e2e.trycloudflare.com";

const delivery = (fields: Partial<E2eWebhookDelivery> = {}): E2eWebhookDelivery => ({
  topic: "shop/redact",
  webhookId: "w-1",
  shop: SAMPLE_SHOP,
  marker: "m-1",
  status: 200,
  receivedAt: DateTime.makeUnsafe(0),
  ...fields,
});

const expected = { topic: "shop/redact", marker: "m-1", shop: SAMPLE_SHOP };

describe("deliveryAddress", () => {
  it("puts a relative uri's path on the tunnel, marked", () => {
    assert.strictEqual(
      deliveryAddress(TUNNEL, "/webhooks/compliance", "m-1").href,
      `${TUNNEL}/webhooks/compliance?${E2E_WEBHOOK_MARKER_PARAM}=m-1`,
    );
  });

  it("keeps only the path of a uri on an absolute origin, the app's released URL", () => {
    assert.strictEqual(
      deliveryAddress(TUNNEL, "https://app.example.com/webhooks/shop?x=1#h", "m-2").href,
      `${TUNNEL}/webhooks/shop?${E2E_WEBHOOK_MARKER_PARAM}=m-2`,
    );
  });

  it("keeps a path that names another host on the tunnel", () => {
    for (const uri of ["//other.example/webhooks/x", String.raw`/\\other.example/x`]) {
      const address = deliveryAddress(TUNNEL, uri, "m-3");
      assert.strictEqual(address.origin, TUNNEL);
    }
    assert.strictEqual(
      deliveryAddress(`${TUNNEL}/ignored?q=1`, "//other.example/webhooks/x", "m").href,
      `${TUNNEL}/webhooks/x?${E2E_WEBHOOK_MARKER_PARAM}=m`,
    );
  });
});

describe("deliveryProblems", () => {
  it("passes exactly one marked delivery of the topic, for the shop, answered 200", () => {
    const others = [
      delivery({ marker: null, webhookId: "real" }),
      delivery({ marker: "m-0", status: 500 }),
    ];
    assert.deepStrictEqual(deliveryProblems([...others, delivery()], expected), []);
  });

  it("ignores every delivery without the trigger's marker", () => {
    const unmarked = [
      delivery({ marker: null }),
      delivery({ marker: "m-0" }),
      delivery({ marker: "m-10" }),
    ];
    assert.deepStrictEqual(deliveriesOf(unmarked, "m-1"), []);
    assert.deepStrictEqual(deliveryProblems(unmarked, expected), [
      "0 deliveries carry the trigger's marker, not 1",
    ]);
  });

  it("fails a duplicate", () => {
    assert.deepStrictEqual(
      deliveryProblems([delivery(), delivery({ webhookId: "w-2" })], expected),
      ["2 deliveries carry the trigger's marker, not 1"],
    );
  });

  it("names a wrong topic, shop or status", () => {
    assert.deepStrictEqual(
      deliveryProblems(
        [delivery({ topic: "shop/update", shop: "pool-14.myshopify.com", status: 401 })],
        expected,
      ),
      [
        "its topic is shop/update, not shop/redact",
        `its shop is pool-14.myshopify.com, not ${SAMPLE_SHOP}`,
        "it was answered 401, not 200",
      ],
    );
    assert.deepStrictEqual(deliveryProblems([delivery({ shop: null })], expected), [
      `its shop is null, not ${SAMPLE_SHOP}`,
    ]);
  });
});

describe("describeDeliveries", () => {
  it("names each delivery's time, topic, webhook id, shop, marker and status", () => {
    assert.strictEqual(describeDeliveries([]), "  (none recorded)");
    assert.strictEqual(
      describeDeliveries([delivery(), delivery({ webhookId: null, status: 401 })]),
      [
        `  1970-01-01T00:00:00.000Z topic=shop/redact webhookId=w-1 shop=${SAMPLE_SHOP} marker=m-1 status=200`,
        `  1970-01-01T00:00:00.000Z topic=shop/redact webhookId=null shop=${SAMPLE_SHOP} marker=m-1 status=401`,
      ].join("\n"),
    );
  });
});
