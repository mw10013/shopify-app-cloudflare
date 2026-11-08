import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PlanCatalog } from "#internal/catalog.ts";
import { ShopifyApp } from "#internal/shopify-app.ts";
import type { ExtraTopics } from "#internal/webhooks.ts";
import { expectTomlMatches } from "#test/node/toml.ts";
import { readWebhooks } from "#test/toml-webhooks.ts";

const catalog = PlanCatalog.make({ "test-basic": {} });
const app = ShopifyApp.define({ catalog, topics: { "orders/create": () => Effect.void } });

describe("ShopifyApp.define", () => {
  it("N10: refuses an extra topic that shadows a built-in one", () => {
    // @ts-expect-error -- a built-in topic as a key is a type error
    const typed: ExtraTopics = { "app/uninstalled": () => Effect.void };
    assert.throws(
      () => ShopifyApp.define({ catalog, topics: typed }),
      /topic=app\/uninstalled: the package answers it/u,
    );
    const widened: Record<string, () => Effect.Effect<void>> = { "shop/redact": () => Effect.void };
    assert.throws(() => ShopifyApp.define({ catalog, topics: widened }), /topic=shop\/redact/u);
  });

  it("lists the built-in topics and the app's extra ones", () => {
    assert.deepStrictEqual(ShopifyApp.topicsOf(app), [
      "customers/data_request",
      "customers/redact",
      "shop/redact",
      "app/scopes_update",
      "app/uninstalled",
      "orders/create",
    ]);
  });
});

const TOML = `# a comment
application_url = "https://example.com"

[webhooks]
api_version = "2026-10" # pinned

[[webhooks.subscriptions]]
uri = "/webhooks/compliance"
compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]

[[webhooks.subscriptions]]
uri = "https://example.com/webhooks/app"
topics = [
  "app/scopes_update",
  "app/uninstalled",
]

[[webhooks.subscriptions]]
uri = "/webhooks/orders"
topics = ["orders/create"]

[build]
automatically_update_urls_on_dev = true
`;

const tomlFile = (contents: string) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "swa-toml-")), "shopify.app.toml");
  writeFileSync(file, contents);
  return file;
};

describe("expectTomlMatches", () => {
  it("reads the api version and every subscription, an array across lines included", () => {
    const { apiVersion, subscriptions } = readWebhooks(TOML);
    assert.strictEqual(apiVersion, "2026-10");
    assert.deepStrictEqual(subscriptions[1], {
      uri: "https://example.com/webhooks/app",
      topics: ["app/scopes_update", "app/uninstalled"],
    });
  });

  it("passes when the toml subscribes exactly the app's topics at the pinned version", () => {
    expectTomlMatches({ tomlPath: tomlFile(TOML), app });
  });

  it("fails on another api version, a uri outside /webhooks/, an unhandled or an unsubscribed topic", () => {
    for (const broken of [
      TOML.replace('"2026-10"', '"2026-07"'),
      TOML.replace("/webhooks/orders", "/orders"),
      TOML.replace('["orders/create"]', '["orders/create", "orders/paid"]'),
      TOML.replace('topics = ["orders/create"]', "topics = []"),
    ])
      assert.throws(() => {
        expectTomlMatches({ tomlPath: tomlFile(broken), app });
      });
  });
});
