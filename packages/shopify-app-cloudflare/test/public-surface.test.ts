import { assert, describe, it } from "@effect/vitest";
import * as Backend from "@mw10013/shopify-app-cloudflare/backend";

import { reachedPackages } from "./reach.ts";

/** Names that would hand an app the library, a transport, a token or the signing key. */
const INTERNAL = new Set([
  "ShopifyClient",
  "ShopifyMerchant",
  "AppTokens",
  "importAppTokenKey",
  "AppInstallationStore",
  "AdminUnauthorizedError",
  "WebhookRejectedError",
  "unavailable",
  "isAlchemyRuntime",
  "bestEffort",
  "cachedStatus",
  "planHandleExpiresAt",
  "planSelectionHref",
  "PARTNER_RETRIES",
  "STALE_PLAN_CONCURRENCY",
  "layerHttpClient",
  "bindShopifyApp",
  "bindShopActorObjects",
  "SHOP_ACTOR_OBJECTS_ENV",
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
      "scheduledJob",
      "ShopActorObjects",
      "shopActorObjectMethods",
      "OrphanInstalledError",
      "SHOP_ACTOR_OBJECTS_LIMIT",
      "Auth",
      "SIGN_UP_CLOSED",
      "signInMethods",
      "signInFailures",
      "SignInCodeDelivery",
      "SignInLimiter",
      "Mailer",
      "requireAdmin",
      "serveAdmin",
      "siteAuthControlHandlers",
    ])
      assert.include(exported, name);
    assert.deepStrictEqual(
      exported.filter((name) => INTERNAL.has(name)),
      [],
    );
  });
});

/** The optional peers only `/website/react` needs. */
const isReactPeer = (specifier: string) =>
  specifier === "react" ||
  specifier.startsWith("react/") ||
  specifier.startsWith("@tanstack/") ||
  specifier.startsWith("@effect/atom-react");

describe("/website", () => {
  it("reaches no React and no TanStack, so a Website that imports only it needs neither", () => {
    assert.deepStrictEqual(reachedPackages("website.ts").filter(isReactPeer), []);
  });
});

describe("/website/react", () => {
  it("exports the socket holder, its banners, the live route helpers and the orphan sweep's pages", async () => {
    const exported = Object.keys(await import("@mw10013/shopify-app-cloudflare/website/react"));
    for (const name of [
      "ShopSocket",
      "SocketBanner",
      "RereadFailedBanner",
      "makeLiveReads",
      "makeLiveRoutes",
      "keepLastAnswer",
      "OrphanShopActorObjectsPage",
      "ShopActorObjectsPage",
      "SignInPage",
      "SignOutButton",
      "verifySignInCode",
      "signOut",
    ])
      assert.include(exported, name);
  });
});

/** Better Auth and its Alchemy layer, which only the Backend loads. */
const isBetterAuth = (specifier: string) =>
  specifier.startsWith("better-auth") || specifier.startsWith("@alchemy.run/better-auth");

describe("site auth", () => {
  it("only the Backend, the stack and the Node test support reach Better Auth", () => {
    assert.isNotEmpty(reachedPackages("backend.ts").filter(isBetterAuth));
    for (const entry of ["contract.ts", "website.ts", "website-react.ts", "client.ts", "test.ts"])
      assert.deepStrictEqual(reachedPackages(entry).filter(isBetterAuth), [], entry);
  });
});

describe("/test", () => {
  it("exports the door a test Backend mounts", async () => {
    const exported = Object.keys(await import("@mw10013/shopify-app-cloudflare/test"));
    for (const name of [
      "ShopifyTestDoor",
      "ShopifyTestDoorRpcs",
      "SHOPIFY_TEST_DOOR_PATH",
      "SHOPIFY_TEST_DOOR_CAN",
      "BehaviorOutcome",
      "SeedInstallation",
    ])
      assert.include(exported, name);
  });

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
