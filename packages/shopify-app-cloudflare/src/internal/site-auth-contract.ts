/**
 * Imports only `effect`, so the Website and the browser load it without Better Auth.
 *
 * @module
 */

import * as Duration from "effect/Duration";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { ForbiddenError } from "./shop-actor-contract.ts";

/** The longest address SMTP carries (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/**
 * An email address, trimmed and lowercased on decode, as Better Auth stores it: the one identity
 * of a site user.
 */
export const Email = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isMaxLength(EMAIL_MAX_LENGTH, { message: "Enter at most 254 characters" }),
      Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, { message: "Enter an email address" }),
    ).pipe(Schema.brand("Email")),
    {
      decode: SchemaGetter.transform((value) => value.trim().toLowerCase()),
      encode: SchemaGetter.transform((value) => value),
    },
  ),
);
export type Email = typeof Email.Type;

/** Better Auth's `user.role` under its admin plugin: `admin` runs the site, anyone else is `user`. */
export const Role = Schema.Literals(["admin", "user"]);
export type Role = typeof Role.Type;

export const SiteUser = Schema.Struct({ id: Schema.String, email: Email, role: Role });
export type SiteUser = typeof SiteUser.Type;

/**
 * What a server function forwards from the browser's request to the Backend; nothing else
 * crosses. A Backend method resolves the session from `cookie` itself, and `ip` keys the sign-in
 * rate limit.
 */
export const RequestInfo = Schema.Struct({
  cookie: Schema.optional(Schema.String),
  ip: Schema.optional(Schema.String),
});
export type RequestInfo = typeof RequestInfo.Type;

export const SIGN_IN_CODE_LENGTH = 6;

export const SIGN_IN_CODE_TTL = Duration.minutes(5);

/** How many wrong guesses one sign-in code survives before it is spent. */
export const SIGN_IN_CODE_ATTEMPTS = 3;

/** A sign-in code as Better Auth's email OTP plugin makes it. */
export const SignInCode = Schema.String.check(
  Schema.isPattern(new RegExp(`^[0-9]{${String(SIGN_IN_CODE_LENGTH)}}$`, "u")),
).pipe(Schema.brand("SignInCode"));
export type SignInCode = typeof SignInCode.Type;

export const SignInCodeRequest = Schema.Struct({ email: Email });
export type SignInCodeRequest = typeof SignInCodeRequest.Type;

/**
 * `requestSignInCode`'s answer, the same whether or not the address may sign in. `code` is Some
 * only under inline delivery, and crosses the binding as `string | null`.
 */
export const SignInCodeRequested = Schema.Struct({ code: Schema.OptionFromNullOr(SignInCode) });
export type SignInCodeRequested = typeof SignInCodeRequested.Type;

/** No session, or one Better Auth refuses. */
export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {},
) {
  override get message() {
    return "Sign in to continue";
  }
}

/** The sign-in rate limit refused the request, for the address or for the client. */
export class TooManyRequestsError extends Schema.TaggedError<TooManyRequestsError>()(
  "TooManyRequestsError",
  {},
) {
  override get message() {
    return "Too many attempts. Try again in a minute.";
  }
}

/** How the admin gate refuses: signed out, or signed in as someone who is not an admin. */
export const AdminRefusal = Schema.Union([UnauthorizedError, ForbiddenError]);
export type AdminRefusal = typeof AdminRefusal.Type;

/** Where Better Auth's endpoints live on the Website and the Backend alike. */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The only Better Auth endpoints a browser reaches: the code check that sets the session cookie,
 * and sign-out. A code is requested through the Backend's `requestSignInCode`, which applies the
 * rate limit and the sign-up rule first.
 */
export const AUTH_ENDPOINTS: readonly { readonly method: string; readonly path: string }[] = [
  { method: "POST", path: `${AUTH_BASE_PATH}/sign-in/email-otp` },
  { method: "POST", path: `${AUTH_BASE_PATH}/sign-out` },
];

export const isAuthEndpoint = (method: string, pathname: string): boolean =>
  AUTH_ENDPOINTS.some((endpoint) => endpoint.method === method && endpoint.path === pathname);

/**
 * The site auth procedures an app's control door mounts beside its own (`RpcGroup.merge`).
 * `IssueSignInCode` answers a fresh sign-in code for an address that may sign in, never
 * delivered, so a test runner signs in on a stage that mails codes.
 */
export const SiteAuthControlRpcs = RpcGroup.make(
  Rpc.make("IssueSignInCode", {
    payload: { email: Email },
    success: Schema.Struct({ code: SignInCode }),
  }),
);
