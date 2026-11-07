/**
 * What runs inside an app's Website Worker and its pages: App Bridge, Polaris and the merchant
 * guard.
 *
 * @module
 */

/** App Bridge, which the Shopify admin requires as the App Home document's first script. */
export const APP_BRIDGE_URL = "https://cdn.shopify.com/shopifycloud/app-bridge.js";

/**
 * Polaris web components, pinned to the 2.0 line with `@shopify/polaris-types` at the matching
 * `2.0.*`: Shopify publishes each minor line at its own URL.
 */
export const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris-2.0.js";
