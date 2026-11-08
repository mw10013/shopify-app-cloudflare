import { assert, describe, it } from "@effect/vitest";
import * as Backend from "@mw10013/shopify-app-workers/backend";

import { reachedPackages } from "./reach.ts";

/** Names that would hand an app the library, a transport, a token or the grantor. */
const INTERNAL = new Set([
  "ShopifyClient",
  "ShopifyMerchant",
  "ShopGrantor",
  "ShopGrantorLive",
  "ShopGrantors",
  "makeGrantor",
  "AppInstallationStore",
  "AdminUnauthorizedError",
  "WebhookRejectedError",
  "unavailable",
  "crossDefects",
  "GrantorProbe",
  "isAlchemyRuntime",
  "bestEffort",
  "cachedStatus",
  "planHandleExpiresAt",
  "planSelectionHref",
  "PARTNER_RETRIES",
  "STALE_PLAN_CONCURRENCY",
  "layerHttpClient",
  "bindShopifyApp",
  "shopifyCredentialsConfig",
  "partnerConfig",
]);

describe("/backend", () => {
  it("exports both tiers and none of their internals", () => {
    const exported = Object.keys(Backend);
    for (const name of [
      "Shopify",
      "ShopifyAccess",
      "AppInstallations",
      "AdminToken",
      "ShopifyApp",
      "SubscriptionPlan",
      "MerchantGate",
      "Webhooks",
      "PartnerApi",
      "PartnerConfig",
      "BUILT_IN_TOPICS",
      "MalformedWebhookError",
      "decodePayload",
      "MerchantAuthenticated",
      "AuthenticateMerchantInput",
      "serve",
      "serveAll",
    ])
      assert.include(exported, name);
    assert.deepStrictEqual(
      exported.filter((name) => INTERNAL.has(name)),
      [],
    );
  });
});

describe("/test", () => {
  it("reaches no test runner and no node:sqlite, so a test Backend in workerd can bundle it", () => {
    const reached = reachedPackages("test.ts");
    assert.include(reached, "@shopify/shopify-api/runtime");
    assert.deepStrictEqual(
      reached.filter(
        (specifier) =>
          specifier === "node:sqlite" ||
          specifier.includes("vitest") ||
          specifier.startsWith("#test/node"),
      ),
      [],
    );
  });
});
