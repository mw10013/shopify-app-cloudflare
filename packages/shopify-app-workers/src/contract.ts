/**
 * What crosses between an app's Workers and the browser: the brands, the errors and the failure
 * schemas. Free of `@shopify/shopify-api`, so the Website imports it without loading the library.
 *
 * @module
 */

export {
  AccessDeniedError,
  AppNotInstalledError,
  AuthenticateMerchantFailure,
  AuthenticateMerchantInput,
  InvalidIdTokenError,
  MerchantAuthenticated,
  MerchantRefusal,
  PlanUnsubscribedError,
  ReauthenticationRequiredError,
  ShopifyAccessFailure,
  ShopifyUnavailableError,
  ShopInaccessibleError,
} from "#internal/contract.ts";
export { E2eShopStatus } from "#internal/e2e-status.ts";
export { ID_MAX_LENGTH, PlanHandle, ShopDomain, ShopGid } from "#internal/domain.ts";
