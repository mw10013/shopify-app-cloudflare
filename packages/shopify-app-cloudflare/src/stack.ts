/**
 * Stack-time helpers for an app's `alchemy.run.ts`: the bindings the package's layers read. Kept
 * apart from `/backend` so Alchemy stack code stays out of the Worker bundle, and free of
 * `@shopify/shopify-api`, so the stack never loads it.
 *
 * @module
 */

export { PartnerConfig, type SignInCodeDeliveryMode } from "#internal/bindings.ts";
export {
  type AppIdentity,
  type BindableWorker,
  bindE2eSession,
  bindShopActorObjects,
  bindShopifyApp,
  bindSiteAuth,
  deployedShopifyApp,
  fakeShopifyApp,
  partnerBindingFromConfig,
  readAppIdentity,
  seedSiteUsers,
  type ShopifyAppBinding,
  shopifyCliApp,
  siteUserSeedSql,
  type SiteUserSeed,
} from "#internal/stack.ts";
