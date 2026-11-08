/**
 * Stack-time helpers for an app's `alchemy.run.ts`: the bindings the package's layers read. Kept
 * apart from `/backend` so Alchemy stack code stays out of the Worker bundle, and free of
 * `@shopify/shopify-api`, so the stack never loads it.
 *
 * @module
 */

export { PartnerConfig } from "#internal/bindings.ts";
export {
  type BindableWorker,
  bindShopifyApp,
  deployedShopifyApp,
  fakeShopifyApp,
  partnerBindingFromConfig,
  type ShopifyAppBinding,
  shopifyCliApp,
} from "#internal/stack.ts";
