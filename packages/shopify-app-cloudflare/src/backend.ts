/**
 * What runs inside an app's Backend Worker: authentication, billing and webhooks.
 *
 * @module
 */

export * from "./contract.ts";
export { AdminToken } from "#internal/admin-token.ts";
export type { RedactedPageInput } from "#internal/app-installation-store.ts";
export { AppSubscription, PlanCatalog, PlanStatus } from "#internal/catalog.ts";
export { type PlanRevalidation, ShopifyHooks, type ShopifyHooksShape } from "#internal/hooks.ts";
export {
  MerchantGate,
  type MerchantGateShape,
  type MerchantStanding,
} from "#internal/merchant-gate.ts";
export {
  PartnerApi,
  type PartnerApiOptions,
  type PartnerApiShape,
  type PartnerSubscription,
} from "#internal/partner-api.ts";
export {
  AppInstallations,
  type AppInstallationsShape,
  ShopifyAccess,
} from "#internal/shopify-access.ts";
export { ShopifyApp, type ShopifyAppDefinition } from "#internal/shopify-app.ts";
export { PartnerConfig, type ShopifyCredentials } from "#internal/bindings.ts";
export {
  type AdminGraphqlFailure,
  type EnsureSessionFailure,
  Shopify,
  type ShopifyShape,
} from "#internal/shopify.ts";
export {
  PLAN_HANDLE_BOUNDARY_SKEW,
  PLAN_HANDLE_MANAGE_WINDOW,
  PLAN_HANDLE_MAX_AGE,
  type PlanCacheRow,
  SubscriptionPlan,
  type SubscriptionPlanShape,
} from "#internal/subscription-plan.ts";
export { type Failures, type Served, serve, serveAll } from "#internal/serve.ts";
export {
  Auth,
  type AuthOptions,
  type AuthShape,
  type RunHook,
  SIGN_UP_CLOSED,
  type SignUpRule,
  type SiteSession,
} from "#internal/site-auth.ts";
export {
  type Mail,
  Mailer,
  SentMail,
  SignInCodeDelivery,
  signInFailures,
  SignInLimiter,
  signInMethods,
  siteAuthControlHandlers,
} from "#internal/sign-in.ts";
export { type AdminServed, requireAdmin, serveAdmin } from "#internal/site-admin.ts";
export {
  type CallerSchema,
  ConnectionIdentity,
  DispatchingSocket,
  refusedUpgrade,
  type SocketIdentity,
} from "#internal/actor-socket.ts";
export {
  type ActorGate,
  actorKeyFromPath,
  actorUpgrade,
  forwardedUpgrade,
  type GateRefusal,
  isActorPath,
  merchantGate,
  refusalClose,
} from "#internal/actor-upgrade.ts";
export { crossDefects, logDefect } from "#internal/defects.ts";
export {
  ABORT_UNINSTALLED,
  type ShopActorBuild,
  type ShopActorContext,
  ShopActorKit,
  type ShopActorKitOptions,
  type ShopActorLifecycle,
  type ShopActorShape,
  type ShopActorSocketHooks,
  type StubMethods,
  ShopNotInstalledError,
} from "#internal/shop-actor-kit.ts";
export { adminShopMethods } from "#internal/admin-shop-methods.ts";
export {
  ShopActorObjects,
  type ShopActorObjectsShape,
  shopActorObjectMethods,
} from "#internal/shop-actor-objects.ts";
export {
  settleDestroy,
  ShopActors,
  type ShopActorsShape,
  shopActorHooks,
} from "#internal/shop-actors.ts";
export { layerStrictJson, strictCodecJson } from "#internal/strict-serialization.ts";
export { syncTransaction, type Transaction } from "#internal/transaction.ts";
export { scheduledJob } from "#internal/scheduled.ts";
export { ADMIN_API_VERSION, PARTNER_API_VERSION } from "#internal/versions.ts";
export { BUILT_IN_TOPICS, type BuiltInTopic } from "#internal/webhook-topics.ts";
export {
  decodePayload,
  type ExtraTopics,
  MalformedWebhookError,
  type TopicHandler,
  type WebhookDelivery,
  Webhooks,
  type WebhooksShape,
} from "#internal/webhooks.ts";
