/**
 * The values another service issues for a deployed stage, each named after the variable
 * `vp run stage up` writes to the stage's Workers Builds trigger from `.env.<stage>` and after the
 * Backend binding it becomes. Shopify issues all of them: the app's secret and its Partner values
 * ({@link PartnerConfig}). The app's handle and client ID come from its `shopify.app.<stage>.toml`,
 * not from here. `dev` and `e2e` read none of them from here.
 *
 * @module
 */

import { PartnerConfig } from "@mw10013/shopify-app-cloudflare/stack";
import * as Schema from "effect/Schema";

export default Schema.Struct({
  SHOPIFY_API_SECRET: Schema.Redacted(Schema.NonEmptyString),
  ...PartnerConfig.fields,
});
