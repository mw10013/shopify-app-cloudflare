import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { AppInstallation } from "./app-installation.ts";

export const MERCHANT_ACCESS_TOKEN_BUFFER = Duration.seconds(30);

export const BACKGROUND_ACCESS_TOKEN_BUFFER = Duration.minutes(5);

/** An access token an Admin API call is made with, and when it expires. A caller never keeps one across calls. */
export const AdminToken = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  accessTokenExpiresAt: Schema.DateTimeUtcFromMillis,
});
export type AdminToken = typeof AdminToken.Type;

/**
 * Whether `expiresAt` is still more than `buffer` away at `now`. Decided from the stored
 * instant and `DateTime.now`, never `Session.isExpired`, which reads `Date.now()`.
 */
export const freshAt = (expiresAt: DateTime.Utc, now: DateTime.Utc, buffer: Duration.Duration) =>
  DateTime.isLessThan(DateTime.addDuration(now, buffer), expiresAt);

export const freshToken = (
  row: AppInstallation,
  now: DateTime.Utc,
  buffer: Duration.Duration,
): Option.Option<AdminToken> =>
  row.accessToken !== null &&
  row.accessTokenExpiresAt !== null &&
  freshAt(row.accessTokenExpiresAt, now, buffer)
    ? Option.some({ accessToken: row.accessToken, accessTokenExpiresAt: row.accessTokenExpiresAt })
    : Option.none();
