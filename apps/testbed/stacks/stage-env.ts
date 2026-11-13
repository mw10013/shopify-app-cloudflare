import { PartnerConfig } from "@mw10013/shopify-app-cloudflare/stack";
import * as Schema from "effect/Schema";

export default Schema.Struct({
  SHOPIFY_API_SECRET: Schema.Redacted(Schema.NonEmptyString),
  SHOPIFY_APP_TOKEN_KEY: Schema.Redacted(Schema.NonEmptyString),
  SHOPIFY_APP_TOKEN_KID: Schema.NonEmptyString,
  ...PartnerConfig.fields,
  CONTROL_TOKEN: Schema.Redacted(Schema.NonEmptyString),
});
