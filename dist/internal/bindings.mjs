import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
// src/internal/bindings.ts
/**
* The contract between an app's stack and its Backend: the values `/stack` binds to the Backend
* and the names the package's `layerConfig`s read them by. Both sides import this module, so a
* rename cannot touch one side alone. Free of `@shopify/shopify-api`, so the stack never loads it.
*
* @module
*/
/**
* The logical ids of the Backend's bindings in the stack's state. Renaming one recreates it on
* every stage.
*/
const SHOPIFY_BINDING = "Shopify";
const SHOPIFY_PARTNER_BINDING = "ShopifyPartner";
/** {@link ShopifyCredentials} read from the Backend's bindings, each absent one `None`. */
const shopifyCredentialsConfig = Config.all({
	apiKey: Config.option(Config.String("SHOPIFY_API_KEY")),
	apiSecret: Config.option(Config.Redacted("SHOPIFY_API_SECRET")),
	appUrl: Config.option(Config.String("SHOPIFY_APP_URL"))
});
/**
* A Shopify app's URL handle: the `<handle>` of its pricing page,
* `admin.shopify.com/store/<store>/charges/<handle>/pricing_plans`. Lowercase letters, digits
* and dashes.
*/
const AppHandle = Schema.NonEmptyString.check(Schema.isPattern(/^[a-z0-9-]+$/u));
/** A Partner Dashboard id (an organization's or an app's): the digits in its URL. */
const PartnerId = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9]+$/u));
/**
* `SHOPIFY_APP_HANDLE`, the app's {@link AppHandle}, decoded. Public configuration, not a
* credential: the stack binds it with the app, so the plan selection page never waits on the
* Partner credentials.
*/
const appHandleConfig = Config.String("SHOPIFY_APP_HANDLE").pipe(Config.mapEffect((value) => Schema.decodeUnknownEffect(AppHandle)(value).pipe(Effect.mapError((issue) => new Config.ConfigError(issue)))));
/**
* What the app's Partner organization issues for one stage, beyond the app's key and secret: the
* organization and app ids, and a Partner API token with **Manage apps**. The stack binds them to
* the Backend under these names.
*/
const PartnerConfig = Schema.Struct({
	SHOPIFY_PARTNER_ORG_ID: PartnerId,
	SHOPIFY_PARTNER_APP_ID: PartnerId,
	SHOPIFY_PARTNER_API_TOKEN: Schema.Redacted(Schema.NonEmptyString)
});
/**
* {@link PartnerConfig} read one key at a time, then decoded: a `Config.schema` of the whole
* struct finds nothing among a Worker's bindings, which answer one name at a time (measured in
* baton under `alchemy dev`). The stack reads `.env` or a deploy's environment with it, and the
* Backend its bindings.
*/
const partnerConfig = Config.all({
	SHOPIFY_PARTNER_ORG_ID: Config.String("SHOPIFY_PARTNER_ORG_ID"),
	SHOPIFY_PARTNER_APP_ID: Config.String("SHOPIFY_PARTNER_APP_ID"),
	SHOPIFY_PARTNER_API_TOKEN: Config.Redacted("SHOPIFY_PARTNER_API_TOKEN")
}).pipe(Config.mapEffect((values) => Schema.decodeUnknownEffect(PartnerConfig)(values).pipe(Effect.mapError((issue) => new Config.ConfigError(issue)))));
export { AppHandle, PartnerConfig, SHOPIFY_BINDING, SHOPIFY_PARTNER_BINDING, appHandleConfig, partnerConfig, shopifyCredentialsConfig };
