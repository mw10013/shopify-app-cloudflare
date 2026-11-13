import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** The Shopify app a Backend serves: its key, its secret, its URL and its token signing key. */
export interface ShopifyCredentials {
  readonly apiKey: string;
  /** Verifies ID tokens and webhook HMACs; never sent to the token endpoint. */
  readonly apiSecret: Redacted.Redacted;
  /** The app's URL; its host and scheme are the library's `hostName` and `hostScheme`. */
  readonly appUrl: string;
  /** The application-only grant's private key, PKCS #8 PEM, P-256: `SHOPIFY_APP_TOKEN_KEY`. */
  readonly appTokenKey: Redacted.Redacted;
  /** The `kid` its public JWK is registered under in the Dev Dashboard: `SHOPIFY_APP_TOKEN_KID`. */
  readonly appTokenKid: string;
}

/**
 * The logical ids of the Backend's bindings in the stack's state. Renaming one recreates it on
 * every stage.
 */
export const SHOPIFY_BINDING = "Shopify";
export const SHOPIFY_PARTNER_BINDING = "ShopifyPartner";
export const SHOP_ACTOR_OBJECTS_BINDING = "ShopActorObjects";
export const SITE_AUTH_BINDING = "SiteAuth";

export const SITE_AUTH_ENV = {
  authOrigin: "AUTH_ORIGIN",
  delivery: "SIGN_IN_CODE_DELIVERY",
  dailyCap: "SIGN_IN_CODE_DAILY_CAP",
} as const;

/**
 * Where a stage's sign-in codes go. `inline`: back to the caller that asked, which the sign-in
 * page shows and a test runner types; nothing is mailed. `mailed`: to the address's inbox, which
 * nothing in-process can read. The stack chooses per stage, never anything the browser sends.
 */
export const SignInCodeDeliveryMode = Schema.Literals(["inline", "mailed"]);
export type SignInCodeDeliveryMode = typeof SignInCodeDeliveryMode.Type;

export const SignInCodeDailyCap = Schema.Literals(["on", "off"]);
export type SignInCodeDailyCap = typeof SignInCodeDailyCap.Type;

export const SHOP_ACTOR_OBJECTS_ENV = {
  accountId: "CLOUDFLARE_ACCOUNT_ID",
  apiToken: "CLOUDFLARE_WORKERS_API_TOKEN",
  script: "SHOP_ACTOR_SCRIPT",
} as const;

export const shopifyCredentialsConfig = Config.all({
  apiKey: Config.option(Config.String("SHOPIFY_API_KEY")),
  apiSecret: Config.option(Config.Redacted("SHOPIFY_API_SECRET")),
  appUrl: Config.option(Config.String("SHOPIFY_APP_URL")),
});

export const appTokenConfig = Config.all({
  clientId: Config.option(Config.String("SHOPIFY_API_KEY")),
  key: Config.option(Config.Redacted("SHOPIFY_APP_TOKEN_KEY")),
  kid: Config.option(Config.String("SHOPIFY_APP_TOKEN_KID")),
});

/**
 * A Shopify app's URL handle: the `<handle>` of its pricing page,
 * `admin.shopify.com/store/<store>/charges/<handle>/pricing_plans`. Lowercase letters, digits
 * and dashes.
 */
export const AppHandle = Schema.NonEmptyString.check(Schema.isPattern(/^[a-z0-9-]+$/u));

const PartnerId = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9]+$/u));

export const appHandleConfig: Config.Config<string> = Config.String("SHOPIFY_APP_HANDLE").pipe(
  Config.mapEffect((value) =>
    Schema.decodeUnknownEffect(AppHandle)(value).pipe(
      Effect.mapError((issue) => new Config.ConfigError(issue)),
    ),
  ),
);

/**
 * What the app's Partner organization issues for one stage, beyond the app's key and secret: the
 * organization and app ids, and a Partner API token with **Manage apps**. The stack binds them to
 * the Backend under these names.
 */
export const PartnerConfig = Schema.Struct({
  SHOPIFY_PARTNER_ORG_ID: PartnerId,
  SHOPIFY_PARTNER_APP_ID: PartnerId,
  SHOPIFY_PARTNER_API_TOKEN: Schema.Redacted(Schema.NonEmptyString),
});
export type PartnerConfig = typeof PartnerConfig.Type;

/**
 * {@link PartnerConfig} read one key at a time, then decoded: a `Config.schema` of the whole
 * struct finds nothing among a Worker's bindings, which answer one name at a time (measured in
 * baton under `alchemy dev`). The stack reads `.env` or a deploy's environment with it, and the
 * Backend its bindings.
 */
export const partnerConfig: Config.Config<PartnerConfig> = Config.all({
  SHOPIFY_PARTNER_ORG_ID: Config.String("SHOPIFY_PARTNER_ORG_ID"),
  SHOPIFY_PARTNER_APP_ID: Config.String("SHOPIFY_PARTNER_APP_ID"),
  SHOPIFY_PARTNER_API_TOKEN: Config.Redacted("SHOPIFY_PARTNER_API_TOKEN"),
}).pipe(
  Config.mapEffect((values) =>
    Schema.decodeUnknownEffect(PartnerConfig)(values).pipe(
      Effect.mapError((issue) => new Config.ConfigError(issue)),
    ),
  ),
);
