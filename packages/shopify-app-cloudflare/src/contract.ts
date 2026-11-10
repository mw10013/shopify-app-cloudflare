/**
 * What crosses between an app's Workers and the browser: the brands, the errors and the failure
 * schemas, the redacted `AppInstallation` records `AppInstallations` answers and the orphan sweep's
 * objects and batches. Free of `@shopify/shopify-api`, so the Website imports it without loading
 * the library.
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
export {
  AppInstallationRedacted,
  AppInstallationRedactedPage,
} from "#internal/app-installation.ts";
export {
  DestroyOrphanRequest,
  OrphanInstalledError,
  OrphanShopActorObjectsData,
  SHOP_ACTOR_OBJECTS_LIMIT,
  ShopActorObject,
  ShopActorObjectsData,
  ShopActorObjectsRequest,
} from "#internal/shop-actor-objects-contract.ts";
export {
  E2E_WEBHOOK_MARKER_PARAM,
  E2eShopStatus,
  E2eWebhookDeliveries,
  E2eWebhookDelivery,
} from "#internal/e2e-status.ts";
export { ID_MAX_LENGTH, PlanHandle, ShopDomain, ShopGid } from "#internal/domain.ts";
export {
  ACTOR_PATH,
  type Caller,
  CONNECTION_CLOSE_DISPLACED,
  CONNECTION_CLOSE_FORBIDDEN,
  CONNECTION_CLOSE_NOT_A_MEMBER,
  CONNECTION_CLOSE_PAYMENT_REQUIRED,
  CONNECTION_CLOSE_REVOKED,
  CONNECTION_CLOSE_TRY_AGAIN,
  CONNECTION_CLOSE_UNAUTHENTICATED,
  CONNECTION_CLOSE_UNINSTALLED,
  CONNECTION_HEADER,
  ConnectionMiddleware,
  CurrentCaller,
  ForbiddenError,
  MerchantCaller,
  Notice,
  NoticeFrame,
  OwnNotice,
  RequireMerchant,
} from "#internal/shop-actor-contract.ts";
