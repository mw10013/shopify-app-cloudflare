/**
 * The access token an Admin API call is made with, and when a stored one is fresh enough.
 *
 * @module
 */

import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { AppInstallation } from "./app-installation.ts";

/** How fresh the merchant path needs a stored token: the request finishes on it, and a mint is one round trip. */
export const MERCHANT_ACCESS_TOKEN_BUFFER = Duration.seconds(30);

/** How fresh `ensureSession` needs a stored token: a job's Admin API calls finish on it. */
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

/** A stored row's access token, if it is fresh for `buffer` at `now`. No recorded expiry is not fresh. */
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
