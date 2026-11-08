import * as Schema from "effect/Schema";
declare const InvalidIdTokenError_base: Schema.Class<InvalidIdTokenError, Schema.TaggedStruct<"InvalidIdTokenError", {}>, import("effect/Cause").YieldableError>;
/**
 * The ID token failed a check of the merchant path's verification, or the exchange answered
 * `400 invalid_subject_token`. A caller gets a new ID token from App Bridge and retries, or
 * bounces the document request.
 */
export declare class InvalidIdTokenError extends InvalidIdTokenError_base {
  get message(): string;
}
declare const AppNotInstalledError_base: Schema.Class<AppNotInstalledError, Schema.TaggedStruct<"AppNotInstalledError", {
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
}>, import("effect/Cause").YieldableError>;
/**
 * The shop has no app installation row: the app was never installed here, or was uninstalled.
 * A caller stops and does not retry; a webhook has nothing to do for the shop.
 */
export declare class AppNotInstalledError extends AppNotInstalledError_base {
  get message(): string;
}
declare const ReauthenticationRequiredError_base: Schema.Class<ReauthenticationRequiredError, Schema.TaggedStruct<"ReauthenticationRequiredError", {
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly refreshTokenState: Schema.Literals<readonly ["missing", "expired", "rejected"]>;
}>, import("effect/Cause").YieldableError>;
/**
 * Only a merchant opening the app (a token exchange) restores access. Shopify's word: the
 * merchant grants nothing new. A caller stops until then: a webhook answers 200 without acting,
 * a background job ends its run as a typed failure, and a merchant-triggered action tells the
 * merchant to reopen the app. `refreshTokenState`, for the log, is why no refresh could help:
 * the row has none, it is within its buffer of expiry, or Shopify rejected it.
 */
export declare class ReauthenticationRequiredError extends ReauthenticationRequiredError_base {
  get message(): string;
}
declare const AccessDeniedError_base: Schema.Class<AccessDeniedError, Schema.TaggedStruct<"AccessDeniedError", {
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
}>, import("effect/Cause").YieldableError>;
/**
 * The shop has not granted a scope the call needs (Shopify's `ACCESS_DENIED`). A caller stops: a
 * merchant-triggered action tells the merchant to open the app and approve its access, and a
 * webhook answers 200 without acting.
 */
export declare class AccessDeniedError extends AccessDeniedError_base {
  get message(): string;
}
declare const ShopInaccessibleError_base: Schema.Class<ShopInaccessibleError, Schema.TaggedStruct<"ShopInaccessibleError", {
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly status: Schema.Literals<readonly [402, 423, 403]>;
}>, import("effect/Cause").YieldableError>;
/**
 * The Admin API refused the shop itself, its `status` for the log: 402 for a shop frozen for
 * payment, 423 locked, 403 marked fraudulent. A caller stops and does not retry soon; a webhook
 * answers 200 without acting.
 */
export declare class ShopInaccessibleError extends ShopInaccessibleError_base {
  get message(): string;
}
declare const ShopifyUnavailableError_base: Schema.Class<ShopifyUnavailableError, Schema.TaggedStruct<"ShopifyUnavailableError", {
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
}>, import("effect/Cause").YieldableError>;
/**
 * Shopify could not serve the call now: transient failures after their retries, a deadline,
 * throttling, Shopify's internal error, a grant an uninstall fenced out, a second Admin API 401,
 * or a Partner API outage. The installation may be fine; a caller retries later. It carries no
 * cause: it crosses to the browser, so where it is raised the cause is logged at Warning instead.
 */
export declare class ShopifyUnavailableError extends ShopifyUnavailableError_base {
  get message(): string;
}
/**
 * The five ways a call that needs the shop's app installation fails once the shop is known: what
 * a background job or a webhook handler meets. The sentence each one shows is the app's.
 */
export declare const ShopifyAccessFailure: Schema.Union<readonly [typeof AppNotInstalledError, typeof ReauthenticationRequiredError, typeof AccessDeniedError, typeof ShopInaccessibleError, typeof ShopifyUnavailableError]>;
export type ShopifyAccessFailure = typeof ShopifyAccessFailure.Type;
declare const PlanUnsubscribedError_base: Schema.Class<PlanUnsubscribedError, Schema.TaggedStruct<"PlanUnsubscribedError", {
  readonly href: Schema.String;
}>, import("effect/Cause").YieldableError>;
/**
 * The shop holds no app subscription on a plan in the app's catalog: a verified absence, never a
 * failure to ask. `href` is the plan selection page through `/auth/exit-iframe`, where the
 * browser goes. The App Home guard and every screen read fail with it.
 */
export declare class PlanUnsubscribedError extends PlanUnsubscribedError_base {
  get message(): string;
}
/**
 * How the Backend refuses a merchant's read of the App Home: an ID token it did not verify, or a
 * shop with no app subscription. The Website answers each the same way for every read.
 */
export declare const MerchantRefusal: Schema.Union<readonly [typeof InvalidIdTokenError, typeof PlanUnsubscribedError]>;
export type MerchantRefusal = typeof MerchantRefusal.Type;
/** What the merchant gate's Backend methods declare on the binding (`serveAll`'s table). */
export declare const AuthenticateMerchantFailure: Schema.Union<readonly [typeof InvalidIdTokenError, typeof PlanUnsubscribedError, typeof ShopifyUnavailableError]>;
export type AuthenticateMerchantFailure = typeof AuthenticateMerchantFailure.Type;
/** What the App Home guard sends the Backend: the ID token, and whether the billing redirect brought it. */
export declare const AuthenticateMerchantInput: Schema.Struct<{
  readonly idToken: Schema.NonEmptyString;
  /** The billing redirect's `plan_handle` was present: the plan is re-read, not resolved. */
  readonly billingRedirect: Schema.optional<Schema.Boolean>;
}>;
export type AuthenticateMerchantInput = typeof AuthenticateMerchantInput.Type;
/**
 * The App Home guard's answer: the merchant's shop and the Manage plan page. It names no plan,
 * so the browser never learns the shop's tier.
 */
export declare const MerchantAuthenticated: Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  readonly managePlanUrl: Schema.String;
}>;
export type MerchantAuthenticated = typeof MerchantAuthenticated.Type;
export {};