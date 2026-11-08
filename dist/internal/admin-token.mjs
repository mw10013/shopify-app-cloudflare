import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
// src/internal/admin-token.ts
/**
* The access token an Admin API call is made with, and when a stored one is fresh enough.
*
* @module
*/
/**
* How fresh the merchant path needs a stored token: exchange is cheap and a merchant is
* present.
*/
const MERCHANT_ACCESS_TOKEN_BUFFER = Duration.seconds(30);
/**
* How fresh `ensureSession` needs a stored token: a job's Admin API calls finish on it, and a shop
* refreshes at most about hourly.
*/
const BACKGROUND_ACCESS_TOKEN_BUFFER = Duration.minutes(5);
/** An access token an Admin API call is made with, and when it expires. A caller never keeps one across calls. */
const AdminToken = Schema.Struct({
	accessToken: Schema.NonEmptyString,
	accessTokenExpiresAt: Schema.DateTimeUtcFromMillis
});
/**
* Whether `expiresAt` is still more than `buffer` away at `now`. Decided from the stored
* instant and `DateTime.now`, never `Session.isExpired`, which reads `Date.now()`.
*/
const freshAt = (expiresAt, now, buffer) => DateTime.isLessThan(DateTime.addDuration(now, buffer), expiresAt);
/** A stored row's access token, if it is fresh for `buffer` at `now`. No recorded expiry is not fresh. */
const freshToken = (row, now, buffer) => row.accessToken !== null && row.accessTokenExpiresAt !== null && freshAt(row.accessTokenExpiresAt, now, buffer) ? Option.some({
	accessToken: row.accessToken,
	accessTokenExpiresAt: row.accessTokenExpiresAt
}) : Option.none();
export { AdminToken, BACKGROUND_ACCESS_TOKEN_BUFFER, MERCHANT_ACCESS_TOKEN_BUFFER, freshAt, freshToken };
