/**
 * The fake Shopify app: the credentials a stage without Shopify CLI binds, which only a token or
 * a webhook a test signs verifies against.
 *
 * @module
 */

import * as Redacted from "effect/Redacted";

import type { ShopifyCredentials } from "#internal/bindings.ts";

/** The fake app's API key (its client ID): an ID token's `aud`. */
export const FAKE_SHOPIFY_API_KEY = "fake-api-key";

/**
 * The fake app's API secret. A constant, so a test signs an ID token or a webhook with it as
 * Shopify would with the real app's; it protects nothing, because no real app uses it.
 */
export const FAKE_SHOPIFY_API_SECRET = "fake-api-secret";

/** The fake app's URL. Only its host and scheme reach the library. */
export const FAKE_SHOPIFY_APP_URL = "http://localhost";

/** The fake app's credentials, as `ShopifyAccess.layer` takes them. */
export const FAKE_SHOPIFY_CREDENTIALS: ShopifyCredentials = {
  apiKey: FAKE_SHOPIFY_API_KEY,
  apiSecret: Redacted.make(FAKE_SHOPIFY_API_SECRET),
  appUrl: FAKE_SHOPIFY_APP_URL,
};
