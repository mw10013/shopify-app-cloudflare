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

/** The fake app's handle, which its plan selection URL names. */
export const FAKE_APP_HANDLE = "fake-app";

/** The fake app's URL. Only its host and scheme reach the library. */
export const FAKE_SHOPIFY_APP_URL = "http://localhost";

/**
 * The fake app's application-only signing key, PKCS #8 PEM, P-256. A constant, as the secret is,
 * so `ShopifyFake` registers its public half; no real app registers it.
 */
export const FAKE_APP_TOKEN_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3XpkS3gPksebTcK2
Ogy3nK53NY9xzLH3UxCgSW8nJ2ahRANCAAQN97a1FR7O2qvqEIOKFKr6W52IJFXA
42r8BdJqRS3mBbz+y4TyPCEyZbQQOJ3Wk8CH7Fc/ZSpkldELSftu5wkT
-----END PRIVATE KEY-----`;

/** The `kid` the fake app's key is registered under. */
export const FAKE_APP_TOKEN_KID = "fake-app-token-key";

/** The fake app's credentials, as `ShopifyAccess.layer` takes them. */
export const FAKE_SHOPIFY_CREDENTIALS: ShopifyCredentials = {
  apiKey: FAKE_SHOPIFY_API_KEY,
  apiSecret: Redacted.make(FAKE_SHOPIFY_API_SECRET),
  appUrl: FAKE_SHOPIFY_APP_URL,
  appTokenKey: Redacted.make(FAKE_APP_TOKEN_KEY),
  appTokenKid: FAKE_APP_TOKEN_KID,
};
