/**
 * What crosses between an app's Workers and the browser: the errors a call that needs the shop's
 * app installation can fail with, and the failure schemas a Backend method declares. Imports
 * only the brands, never `@shopify/shopify-api`, so the Website loads it without the library.
 *
 * @module
 */

import * as Schema from "effect/Schema";

import { ShopDomain, ShopGid } from "./domain.ts";

/**
 * The ID token failed a check of the merchant path's verification, or the exchange answered
 * `400 invalid_subject_token`. A caller gets a new ID token from App Bridge and retries, or
 * bounces the document request.
 */
export class InvalidIdTokenError extends Schema.TaggedError<InvalidIdTokenError>()(
  "InvalidIdTokenError",
  {},
) {
  override get message() {
    return "The ID token is invalid or expired";
  }
}

/**
 * The shop has no app installation row: the app was never installed here, or was uninstalled.
 * A caller stops and does not retry; a webhook has nothing to do for the shop.
 */
export class AppNotInstalledError extends Schema.TaggedError<AppNotInstalledError>()(
  "AppNotInstalledError",
  { shop: ShopDomain },
) {
  override get message() {
    return `The app is not installed on ${this.shop}`;
  }
}

/**
 * Only a merchant opening the app (a token exchange) restores access. Shopify's word: the
 * merchant grants nothing new. A caller stops until then: a webhook answers 200 without acting,
 * a background job ends its run as a typed failure, and a merchant-triggered action tells the
 * merchant to reopen the app. `refreshTokenState`, for the log, is why no refresh could help:
 * the row has none, it is within its buffer of expiry, or Shopify rejected it.
 */
export class ReauthenticationRequiredError extends Schema.TaggedError<ReauthenticationRequiredError>()(
  "ReauthenticationRequiredError",
  {
    shop: ShopDomain,
    refreshTokenState: Schema.Literals(["missing", "expired", "rejected"]),
  },
) {
  override get message() {
    return `A merchant must open the app on ${this.shop} to restore access`;
  }
}

/**
 * The shop has not granted a scope the call needs (Shopify's `ACCESS_DENIED`). A caller stops: a
 * merchant-triggered action tells the merchant to open the app and approve its access, and a
 * webhook answers 200 without acting.
 */
export class AccessDeniedError extends Schema.TaggedError<AccessDeniedError>()(
  "AccessDeniedError",
  { shop: ShopDomain },
) {
  override get message() {
    return `${this.shop} has not granted a scope the call needs`;
  }
}

/**
 * The Admin API refused the shop itself, its `status` for the log: 402 for a shop frozen for
 * payment, 423 locked, 403 marked fraudulent. A caller stops and does not retry soon; a webhook
 * answers 200 without acting.
 */
export class ShopInaccessibleError extends Schema.TaggedError<ShopInaccessibleError>()(
  "ShopInaccessibleError",
  { shop: ShopDomain, status: Schema.Literals([402, 423, 403]) },
) {
  override get message() {
    return `The Admin API refused ${this.shop}`;
  }
}

/**
 * Shopify could not serve the call now: transient failures after their retries, a deadline,
 * throttling, Shopify's internal error, a grant an uninstall fenced out, a second Admin API 401,
 * or a Partner API outage. The installation may be fine; a caller retries later. It carries no
 * cause: it crosses to the browser, so where it is raised the cause is logged at Warning instead.
 */
export class ShopifyUnavailableError extends Schema.TaggedError<ShopifyUnavailableError>()(
  "ShopifyUnavailableError",
  { shop: ShopDomain },
) {
  override get message() {
    return `Shopify isn't responding for ${this.shop}`;
  }
}

/**
 * The five ways a call that needs the shop's app installation fails once the shop is known: what
 * a background job or a webhook handler meets. The sentence each one shows is the app's.
 */
export const ShopifyAccessFailure = Schema.Union([
  AppNotInstalledError,
  ReauthenticationRequiredError,
  AccessDeniedError,
  ShopInaccessibleError,
  ShopifyUnavailableError,
]);
export type ShopifyAccessFailure = typeof ShopifyAccessFailure.Type;

/**
 * The shop holds no app subscription on a plan in the app's catalog: a verified absence, never a
 * failure to ask. `href` is the plan selection page through `/auth/exit-iframe`, where the
 * browser goes. The App Home guard and every screen read fail with it.
 */
export class PlanUnsubscribedError extends Schema.TaggedError<PlanUnsubscribedError>()(
  "PlanUnsubscribedError",
  { href: Schema.String },
) {
  override get message() {
    return "The shop has no app subscription";
  }
}

/**
 * How the Backend refuses a merchant's read of the App Home: an ID token it did not verify, or a
 * shop with no app subscription. The Website answers each the same way for every read.
 */
export const MerchantRefusal = Schema.Union([InvalidIdTokenError, PlanUnsubscribedError]);
export type MerchantRefusal = typeof MerchantRefusal.Type;

/** What the merchant gate's Backend methods declare on the binding (`serveAll`'s table). */
export const AuthenticateMerchantFailure = Schema.Union([
  InvalidIdTokenError,
  PlanUnsubscribedError,
  ShopifyUnavailableError,
]);
export type AuthenticateMerchantFailure = typeof AuthenticateMerchantFailure.Type;

/** What the App Home guard sends the Backend: the ID token, and whether the billing redirect brought it. */
export const AuthenticateMerchantInput = Schema.Struct({
  idToken: Schema.NonEmptyString,
  /** The billing redirect's `plan_handle` was present: the plan is re-read, not resolved. */
  billingRedirect: Schema.optional(Schema.Boolean),
});
export type AuthenticateMerchantInput = typeof AuthenticateMerchantInput.Type;

/**
 * The App Home guard's answer: the merchant's shop and the Manage plan page. It names no plan,
 * so the browser never learns the shop's tier.
 */
export const MerchantAuthenticated = Schema.Struct({
  shop: ShopDomain,
  shopGid: ShopGid,
  managePlanUrl: Schema.String,
});
export type MerchantAuthenticated = typeof MerchantAuthenticated.Type;
