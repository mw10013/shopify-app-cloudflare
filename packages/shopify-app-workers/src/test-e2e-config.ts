/**
 * The Playwright config of a Shopify app's e2e run ({@link shopifyE2eConfig}): rigging's
 * `e2eConfig` with the app read from its e2e lease, server and tomls, and the spec pack
 * registered. Runs in Node; needs the optional peers `playwright` and `@mw10013/rigging` 0.4.
 *
 * @module
 */

export { type ShopifyE2e, shopifyE2eConfig, type ShopifyE2eOptions } from "./test/e2e/config.ts";
