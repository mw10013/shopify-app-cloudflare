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
  FAKE_APP_HANDLE,
  FAKE_SHOPIFY_API_KEY,
  FAKE_SHOPIFY_API_SECRET,
  FAKE_SHOPIFY_APP_URL,
  FAKE_APP_TOKEN_KEY,
  FAKE_APP_TOKEN_KID,
  FAKE_SHOPIFY_CREDENTIALS,
} from "./test/fake-app.ts";
export { mintIdToken } from "./test/id-token.ts";
export {
  FAKE_ACCESS_TOKEN_EXPIRES_IN,
  FAKE_SCOPE,
  FAKE_SHOP_GID,
  ShopifyFake,
  ShopifyFakeCall,
  type ShopifyFakeIntercept,
  ShopifyFakeReply,
  ShopifyFakeRoute,
} from "./test/shopify-fake.ts";
export {
  currentMonth,
  fakePlanSelectionUrl,
  PartnerAnswer,
  PartnerFake,
} from "./test/partner-fake.ts";
export {
  type HarnessCapability,
  type HarnessDelivery,
  type HarnessLogLine,
  type HookName,
  SeedInstallation,
  ShopifyHarness,
  type ShopifyHarnessShape,
} from "./test/shopify-harness.ts";
export { deliverWebhook, signWebhook, type WebhookSigning } from "./test/webhook.ts";
export {
  BehaviorOutcome,
  SHOPIFY_TEST_DOOR_CAN,
  SHOPIFY_TEST_DOOR_PATH,
  ShopifyTestDoor,
  type ShopifyTestDoorShape,
  ShopifyTestDoorRpcs,
} from "./test/test-door.ts";
