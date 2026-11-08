import { AccessDeniedError, InvalidIdTokenError, ShopInaccessibleError, ShopifyUnavailableError } from "./contract.mjs";
import { ShopDomain } from "./domain.mjs";
import { ShopifyCredentials } from "./bindings.mjs";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, LogSeverity } from "@shopify/shopify-api";
declare const AdminUnauthorizedError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
  readonly _tag: "AdminUnauthorizedError";
} & Readonly<A>;
/**
 * The Admin API answered 401 to the access token. Never leaves the Admin API call:
 * `Shopify.adminGraphql` retries it once, and the first exchange's `shopGid` fetch fails
 * `ShopifyUnavailableError`.
 */
export declare class AdminUnauthorizedError extends AdminUnauthorizedError_base<{
  readonly shop: ShopDomain;
}> {}
declare const WebhookRejectedError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
  readonly _tag: "WebhookRejectedError";
} & Readonly<A>;
/**
 * `validateWebhook` refused the request: 405 for a method other than POST, 401 for a bad HMAC,
 * 400 for anything else invalid (an empty body, a missing header, a shop domain that is not a
 * {@link ShopDomain}, a body that is not JSON). The caller answers with `status` and nothing else.
 */
export declare class WebhookRejectedError extends WebhookRejectedError_base<{
  readonly status: 400 | 401 | 405;
}> {}
/** The spans whose lines name a Shopify outage. */
export type ShopifySpan = "Shopify.adminGraphql" | "ShopGrantor.exchange" | "ShopGrantor.ensure" | "PartnerApi.activeSubscription" | "MerchantGate.authenticateMerchant";
declare const ShopifyClient_base: Context.ServiceClass<ShopifyClient, "app/ShopifyClient", {
  library: Effect.Effect<import("@shopify/shopify-api").Shopify<{
    apiKey: string;
    apiSecretKey: string;
    hostName: string;
    hostScheme: "http" | "https";
    apiVersion: ApiVersion.October26;
    isEmbeddedApp: true;
    future: {
      customerAddressDefaultFix: true;
      unstable_managedPricingSupport: true;
    };
    logger: {
      level: LogSeverity.Warning;
    };
  }, import("@shopify/shopify-api").ShopifyRestResources, {
    customerAddressDefaultFix: true;
    unstable_managedPricingSupport: true;
  }>, never, never>;
  decodeIdToken: (idToken: string) => Effect.Effect<{
    shop: string & import("effect/Brand").Brand<"ShopDomain">;
    sub: string | undefined;
  }, InvalidIdTokenError, never>;
  adminCall: (span: ShopifySpan, shop: string & import("effect/Brand").Brand<"ShopDomain">, accessToken: string, query: string, variables: Record<string, unknown> | undefined) => Effect.Effect<unknown, AccessDeniedError | AdminUnauthorizedError | ShopInaccessibleError | ShopifyUnavailableError, never>;
  validateWebhook: (request: Request) => Effect.Effect<{
    shop: string & import("effect/Brand").Brand<"ShopDomain">;
    topic: string;
    payload: unknown;
    webhookId: string;
  }, WebhookRejectedError, never>;
}>;
/**
 * The stateless `@shopify/shopify-api` adapter: the library instance, ID token and webhook
 * verification, and one classified Admin API call with a given access token. It holds no token
 * and decides nothing about one: the grantor grants through its `library`, and `Shopify` calls
 * the Admin API through `adminCall` with the stored token.
 */
export declare class ShopifyClient extends ShopifyClient_base {
  /** Given the API key, API secret and app URL. */
  static readonly layer: (credentials: ShopifyCredentials) => Layer.Layer<ShopifyClient, never, never>;
  /**
   * Over `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL`, which the stack binds to
   * the Backend. They are absent while the stack is planned, when nothing calls Shopify; a
   * running Worker without them is broken.
   */
  static readonly layerConfig: Layer.Layer<ShopifyClient, import("effect/Config").ConfigError, never>;
}
export {};