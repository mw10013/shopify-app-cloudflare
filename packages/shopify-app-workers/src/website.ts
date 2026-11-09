/**
 * What runs inside an app's Website Worker and its pages, with no React and no TanStack: Shopify's
 * URLs and headers, the App Bridge page and calls, the merchant gate's refusals and guard, and the
 * server routes' handlers. React's half is `/website/react`.
 *
 * @module
 */

export { mintIdToken, showSaveBar, toast } from "#internal/app-bridge.ts";
export {
  type AppGuardInput,
  type AppGuardReads,
  appGuard,
  type AuthenticateAppInput,
  bearerToken,
  documentGuard,
  type EmbeddedRequest,
  readEmbeddedIdToken,
  forgetAppGuard,
  hasBearer,
  type Redirect,
  type RedirectOptions,
  rememberHydratedAppGuard,
} from "#internal/merchant-request.ts";
export { rescue } from "#internal/rescue.ts";
export {
  APP_BRIDGE_URL,
  type AppSearch,
  appSearch,
  documentHeaders,
  embeddedAppUrl,
  exitIframeDestination,
  idTokenBounce,
  POLARIS_URL,
} from "#internal/shopify-urls.ts";
export {
  actorUpgradeHandlers,
  appBridgePage,
  exitIframeHandlers,
  isCrossSiteUpgrade,
  sessionTokenHandlers,
  type WebsiteBindings,
  webhookHandlers,
} from "#internal/website-routes.ts";
