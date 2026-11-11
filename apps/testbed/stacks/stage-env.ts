/**
 * The values another service issues for a deployed stage, each named after the variable
 * `vp run stage up` writes to the stage's Workers Builds trigger from `.env.<stage>` and after the
 * Backend binding it becomes: the app's secret and its Partner values ({@link PartnerConfig}), which
 * Shopify issues, the app's token signing key and the `kid` its public JWK is registered under in
 * the Dev Dashboard, and `CONTROL_TOKEN`, which a caller of the stage's control door bears. The app's
 * handle and client ID come from its `shopify.app.<stage>.toml`, not from here. `dev` and `e2e`
 * read none of them from here.
 *
 * @module
 */

import { PartnerConfig } from "@mw10013/shopify-app-cloudflare/stack";
import * as Schema from "effect/Schema";

export default Schema.Struct({
  SHOPIFY_API_SECRET: Schema.Redacted(Schema.NonEmptyString),
  SHOPIFY_APP_TOKEN_KEY: Schema.Redacted(Schema.NonEmptyString),
  SHOPIFY_APP_TOKEN_KID: Schema.NonEmptyString,
  ...PartnerConfig.fields,
  CONTROL_TOKEN: Schema.Redacted(Schema.NonEmptyString),
});
