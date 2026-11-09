import { AccessDeniedError, AppNotInstalledError, InvalidIdTokenError, ReauthenticationRequiredError, ShopInaccessibleError, ShopifyAccessFailure, ShopifyUnavailableError } from "./contract.mjs";
import { AppInstallation } from "./app-installation.mjs";
import { ShopDomain, ShopGid } from "./domain.mjs";
import { AdminToken } from "./admin-token.mjs";
import "./app-installation-store.mjs";
import "./shopify-client.mjs";
import "./shop-grantor.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import "effect/Layer";
/** Every way `ensureSession` fails; anything else is a defect. */
export type EnsureSessionFailure = AppNotInstalledError | ReauthenticationRequiredError | ShopifyUnavailableError;
/** Every way `adminGraphql` fails: {@link ShopifyAccessFailure}. Anything else is a defect. */
export type AdminGraphqlFailure = EnsureSessionFailure | AccessDeniedError | ShopInaccessibleError;
export interface ShopifyShape {
  /**
   * An access token fresh for `BACKGROUND_ACCESS_TOKEN_BUFFER`, with no merchant present: the
   * stored one with no hop, or one the shop's grantor refreshed. A caller never keeps it across
   * calls: the next refresh retires it.
   */
  readonly ensureSession: (shop: ShopDomain) => Effect.Effect<AdminToken, EnsureSessionFailure>;
  /**
   * An Admin GraphQL call by shop, never by token: ensures the shop's token, calls, and decodes
   * `data` with `schema`; `data` that does not decode is a defect. A 401 asks the grantor once
   * for a token other than the one that got it and calls again; a second 401 is
   * `ShopifyUnavailableError`: Shopify rejected a token it had just issued. Nothing else is
   * retried: after a transient failure a mutation may or may not have applied, so retrying is
   * the caller's call.
   */
  readonly adminGraphql: <S extends Schema.Top>(shop: ShopDomain, schema: S & {
    readonly DecodingServices: never;
  }, query: string, variables?: Record<string, unknown>) => Effect.Effect<S["Type"], ShopifyAccessFailure>;
}
/** What the merchant path answers. */
export interface AuthenticateMerchantAnswer {
  readonly shop: ShopDomain;
  readonly shopGid: ShopGid;
  /**
   * The row as read before any exchange, none on a first install, so the gate resolves the
   * plan from it without a second read: an exchange rewrites only the grant columns.
   */
  readonly stored: Option.Option<AppInstallation>;
}
export interface ShopifyMerchantShape {
  /**
   * The merchant path, the package's counterpart of Shopify's `authenticate.admin`: an ID token
   * to the shop, answered from a stored token fresh for `MERCHANT_ACCESS_TOKEN_BUFFER` with no
   * hop, or else by the shop's grantor, which exchanges the ID token for an expiring offline
   * token (creating the row on a first install) or answers from a grant already in flight. Scope
   * is not compared: a fresh token stays usable across a scope change until it expires.
   */
  readonly authenticateMerchant: (idToken: string) => Effect.Effect<AuthenticateMerchantAnswer, InvalidIdTokenError | ShopifyUnavailableError>;
}
declare const Shopify_base: Context.ServiceClass<Shopify, "app/Shopify", ShopifyShape>;
/**
 * The shop's Shopify Admin API without a merchant: `ensureSession` for a token and `adminGraphql`
 * for a call by shop. What an app's background work and webhook handlers use.
 */
export declare class Shopify extends Shopify_base {}
declare const ShopifyMerchant_base: Context.ServiceClass<ShopifyMerchant, "app/ShopifyMerchant", ShopifyMerchantShape>;
/** The merchant path. Not exported from the package: the merchant gate is its one caller. */
export declare class ShopifyMerchant extends ShopifyMerchant_base {}
export {};