import { Database as BetterAuthDatabase } from "@alchemy.run/better-auth";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type SignInCodeDeliveryMode, SITE_AUTH_ENV } from "#internal/bindings.ts";
import { Mailer, SignInCodeDelivery, SignInLimiter, signInMethods } from "#internal/sign-in.ts";
import { AUTH_BASE_PATH, type Email, SignInCodeRequested } from "#internal/site-auth-contract.ts";
import { Auth, type AuthOptions, SIGN_UP_CLOSED } from "#internal/site-auth.ts";
import { type SiteUserSeed, siteUserSeedSql } from "#internal/stack.ts";

import { D1Test } from "./d1-test.ts";

/** The Website origin the test Better Auth serves and sets its cookie on. */
export const SITE_AUTH_TEST_ORIGIN = "http://site.test";

const decodeRequested = Schema.decodeUnknownSync(SignInCodeRequested);

/** `request`'s answer from `Auth.serve`, as the Backend's `fetch` gives it. */
const serve = Effect.fn("SiteAuthTest.serve")(function* (request: Request) {
  const auth = yield* Auth;
  const response = yield* auth.serve.pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
    Effect.scoped,
  );
  return HttpServerResponse.toWeb(response);
});

/** A POST to one of Better Auth's endpoints from the Website's origin. */
const authRequest = (path: string, body: unknown, cookie?: string) =>
  new Request(`${SITE_AUTH_TEST_ORIGIN}${AUTH_BASE_PATH}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE_AUTH_TEST_ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });

/** The `cookie` header a browser would send back after `response`. */
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

/** Checks `code` for `email` as the sign-in page does, and answers Better Auth's response. */
const verify = (email: Email, code: string) =>
  serve(authRequest("/sign-in/email-otp", { email, otp: code }));

/**
 * Requests a code for `email` through `requestSignInCode`, as the sign-in page does, checks it,
 * and answers the session's `cookie` header. Needs inline delivery; dies when no code comes back
 * or Better Auth refuses it.
 */
const signIn = Effect.fn("SiteAuthTest.signIn")(function* (email: Email) {
  const methods = yield* signInMethods;
  const answer = yield* methods
    .requestSignInCode({ cookie: undefined, ip: undefined }, { email })
    .pipe(Effect.orDie);
  const code = decodeRequested(answer).code;
  if (Option.isNone(code)) return yield* Effect.die(new Error(`no code came back for ${email}`));
  const response = yield* verify(email, code.value);
  if (!response.ok)
    return yield* Effect.die(new Error(`sign-in answered ${String(response.status)}`));
  return cookieOf(response);
});

export const SiteAuthTest = {
  /**
   * Site auth over a fresh `D1Test` migrated from `migrationsDir` (the package's by default),
   * with `users` seeded as the stage's seed writes them, codes delivered by `delivery` (inline
   * by default) over `Mailer.layerTest`, and `limiter` (open by default). Everything it builds
   * stays in its output, so a test reaches `SentMail` and the database too.
   */
  layer: <R = never>(
    options: {
      readonly signUp?: AuthOptions<R>["signUp"];
      readonly databaseHooks?: AuthOptions<R>["databaseHooks"];
      readonly users?: readonly SiteUserSeed[];
      readonly delivery?: SignInCodeDeliveryMode;
      readonly limiter?: Layer.Layer<SignInLimiter>;
      readonly migrationsDir?: string;
    } = {},
  ) =>
    Auth.layer({
      signUp: options.signUp ?? (SIGN_UP_CLOSED as AuthOptions<R>["signUp"]),
      ...(options.databaseHooks === undefined ? {} : { databaseHooks: options.databaseHooks }),
      secret: "site-auth-test-secret-site-auth-test-secret",
    }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          (options.delivery === "mailed"
            ? SignInCodeDelivery.layerMailed({ appName: "Test App" })
            : SignInCodeDelivery.layerInline
          ).pipe(Layer.provideMerge(Mailer.layerTest)),
          options.limiter ?? SignInLimiter.layerNoop,
        ),
      ),
      Layer.provideMerge(
        Layer.unwrap(
          Effect.gen(function* () {
            const { database, sqlite } = yield* D1Test;
            sqlite.exec(siteUserSeedSql(options.users ?? []));
            return Layer.succeed(BetterAuthDatabase, {
              provider: "sqlite",
              runtime: Effect.succeed(database),
            });
          }),
        ),
      ),
      Layer.provideMerge(D1Test.layer({ migrationsDir: options.migrationsDir })),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ [SITE_AUTH_ENV.authOrigin]: SITE_AUTH_TEST_ORIGIN }),
        ),
      ),
    ),
  serve,
  authRequest,
  cookieOf,
  verify,
  signIn,
};
