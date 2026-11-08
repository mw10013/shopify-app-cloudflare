/**
 * Test support that runs in Node and in workerd alike: the Shopify fake, the fake app, ID token
 * and webhook signing, and the required-behavior cases as data. Nothing here imports a test
 * runner or `node:sqlite`; `/test/node` holds what needs Node.
 *
 * @module
 */

export {
  AUTH_BEHAVIORS,
  BEHAVIOR_SHOP,
  BEHAVIOR_SHOP_GID,
  type RequiredBehavior,
} from "./test/auth-behaviors.ts";
export { APP_BEHAVIORS } from "./test/app-behaviors.ts";
export { REQUIRED_BEHAVIORS } from "./test/required-behaviors.ts";
export { BEHAVIOR_CATALOG, BEHAVIOR_PROBE_TOPIC, behaviorApp } from "./test/behavior-app.ts";
export {
  FAKE_SHOPIFY_API_KEY,
  FAKE_SHOPIFY_API_SECRET,
  FAKE_SHOPIFY_APP_URL,
  FAKE_SHOPIFY_CREDENTIALS,
} from "./test/fake-app.ts";
export { mintIdToken } from "./test/id-token.ts";
export {
  FAKE_ACCESS_TOKEN_EXPIRES_IN,
  FAKE_REFRESH_TOKEN_EXPIRES_IN,
  FAKE_SCOPE,
  FAKE_SHOP_GID,
  grantBody,
  REFRESH_GRANT,
  ShopifyFake,
  ShopifyFakeCall,
  type ShopifyFakeIntercept,
  ShopifyFakeReply,
  ShopifyFakeRoute,
  TOKEN_EXCHANGE_GRANT,
} from "./test/shopify-fake.ts";
export {
  currentMonth,
  FAKE_APP_HANDLE,
  fakePlanSelectionUrl,
  PartnerAnswer,
  PartnerFake,
} from "./test/partner-fake.ts";
export {
  type HarnessCapability,
  type HarnessDelivery,
  type HarnessLogLine,
  type HeldWrite,
  type HookName,
  type SeedInstallation,
  ShopifyHarness,
  type ShopifyHarnessShape,
} from "./test/shopify-harness.ts";
export { deliverWebhook, signWebhook, type WebhookSigning } from "./test/webhook.ts";
