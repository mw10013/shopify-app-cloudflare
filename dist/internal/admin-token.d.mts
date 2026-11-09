import "./app-installation.mjs";
import * as Schema from "effect/Schema";
import "effect/DateTime";
import "effect/Duration";
import "effect/Option";
/** An access token an Admin API call is made with, and when it expires. A caller never keeps one across calls. */
export declare const AdminToken: Schema.Struct<{
  readonly accessToken: Schema.NonEmptyString;
  readonly accessTokenExpiresAt: Schema.DateTimeUtcFromMillis;
}>;
export type AdminToken = typeof AdminToken.Type;