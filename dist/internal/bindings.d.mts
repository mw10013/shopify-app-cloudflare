import * as Schema from "effect/Schema";
import "effect/Config";
import * as Redacted from "effect/Redacted";
/** The Shopify app a Backend serves: its key, its secret and its URL. */
export interface ShopifyCredentials {
  readonly apiKey: string;
  readonly apiSecret: Redacted.Redacted;
  /** The app's URL; its host and scheme are the library's `hostName` and `hostScheme`. */
  readonly appUrl: string;
}
/**
 * What the app's Partner organization issues for one stage, beyond the app's key and secret: the
 * organization and app ids, and a Partner API token with **Manage apps**. The stack binds them to
 * the Backend under these names.
 */
export declare const PartnerConfig: Schema.Struct<{
  readonly SHOPIFY_PARTNER_ORG_ID: Schema.NonEmptyString;
  readonly SHOPIFY_PARTNER_APP_ID: Schema.NonEmptyString;
  readonly SHOPIFY_PARTNER_API_TOKEN: Schema.Redacted<Schema.NonEmptyString>;
}>;
export type PartnerConfig = typeof PartnerConfig.Type;