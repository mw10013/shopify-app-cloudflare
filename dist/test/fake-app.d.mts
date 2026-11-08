import { ShopifyCredentials } from "../internal/bindings.mjs";
/** The fake app's API key (its client ID): an ID token's `aud`. */
export declare const FAKE_SHOPIFY_API_KEY = "fake-api-key";
/**
 * The fake app's API secret. A constant, so a test signs an ID token or a webhook with it as
 * Shopify would with the real app's; it protects nothing, because no real app uses it.
 */
export declare const FAKE_SHOPIFY_API_SECRET = "fake-api-secret";
/** The fake app's handle, which its plan selection URL names. */
export declare const FAKE_APP_HANDLE = "fake-app";
/** The fake app's URL. Only its host and scheme reach the library. */
export declare const FAKE_SHOPIFY_APP_URL = "http://localhost";
/** The fake app's credentials, as `ShopifyAccess.layer` takes them. */
export declare const FAKE_SHOPIFY_CREDENTIALS: ShopifyCredentials;