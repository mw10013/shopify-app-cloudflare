import { BetterAuth, Database as BetterAuthDatabase } from "@alchemy.run/better-auth";
import type * as Workers from "@cloudflare/workers-types";
import { RuntimeContext } from "alchemy";
import type { BetterAuthOptions } from "better-auth";
import { admin, emailOTP } from "better-auth/plugins";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { SignInCodeDailyCap, SITE_AUTH_ENV } from "./bindings.ts";
import { isAlchemyRuntime } from "./shopify-client.ts";
import {
  AUTH_BASE_PATH,
  Email,
  isAuthEndpoint,
  SIGN_IN_CODE_ATTEMPTS,
  SIGN_IN_CODE_LENGTH,
  SIGN_IN_CODE_TTL,
  SIGN_IN_CODES_PER_DAY,
  SignInCode,
  SiteUser,
  UnauthorizedError,
} from "./site-auth-contract.ts";

/**
 * Whether an address with no user yet may sign up: its first sign-in creates a user with the role
 * `user`. Checked before a code is issued and again before Better Auth creates the user.
 */
export type SignUpRule<R = never> = (email: Email) => Effect.Effect<boolean, never, R>;

/** No one signs up: only the users the stage's seed writes sign in. */
export const SIGN_UP_CLOSED: SignUpRule = () => Effect.succeed(false);

/** Runs an app hook's Effect inside a Better Auth callback, with its own scope for D1. */
export type RunHook<R> = <A>(effect: Effect.Effect<A, never, R>) => Promise<A>;

export interface AuthOptions<R = never> {
  readonly signUp: SignUpRule<R>;
  /**
   * The app's Better Auth database hooks, such as closing a deleted session's sockets. The
   * package's own `user.create.before`, the sign-up rule, runs first; the app's runs after it.
   */
  readonly databaseHooks?: (run: RunHook<R>) => NonNullable<BetterAuthOptions["databaseHooks"]>;
  /**
   * The Better Auth signing secret. Omitted, it is an `Alchemy.Random` resource held in state,
   * which needs a stack; a test passes a literal.
   */
  readonly secret?: string | Redacted.Redacted;
}

/** A signed-in session, as the Backend reads it from a request's cookie. */
export interface SiteSession {
  readonly user: SiteUser;
  readonly sessionId: string;
  readonly expiresAt: DateTime.Utc;
}

export interface AuthShape {
  /**
   * Serves the request in context through Better Auth when it is one of `AUTH_ENDPOINTS`, and
   * answers `404` otherwise, so no Website route can reach another endpoint.
   */
  readonly serve: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >;
  /** The session a `cookie` header value carries, or {@link UnauthorizedError}. */
  readonly session: (cookie: string | undefined) => Effect.Effect<SiteSession, UnauthorizedError>;
  /** Whether a code for the address could sign anyone in: a user exists, or the rule admits one. */
  readonly maySignIn: (email: Email) => Effect.Effect<boolean>;
  /**
   * Counts a code request from the sign-in page against the address's UTC day, and answers
   * whether it is within {@link SIGN_IN_CODES_PER_DAY}. Where `bindSiteAuth` binds no cap it
   * counts nothing and admits every request.
   */
  readonly admitCodeRequest: (email: Email) => Effect.Effect<boolean>;
  /** A fresh sign-in code for the address, stored hashed. It is not delivered anywhere. */
  readonly issueSignInCode: (email: Email) => Effect.Effect<SignInCode>;
}

const BETTER_AUTH_SEVERITY = {
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
} as const;

/**
 * Better Auth's line for a refused origin or redirect target, which it logs at error. Anyone can
 * send one, and the refusal is the right answer, so it is a warning here.
 */
const REFUSED_TARGET =
  /^Invalid (?:origin|callbackURL|redirectURL|errorCallbackURL|newUserCallbackURL): /u;

const decodeEmail = Schema.decodeUnknownOption(Email);
const decodeSiteUser = Schema.decodeUnknownEffect(SiteUser);
const decodeSignInCode = Schema.decodeUnknownEffect(SignInCode);
const decodeExpiresAt = Schema.decodeUnknownEffect(Schema.DateTimeUtcFromDate);
const decodeCounted = Schema.decodeUnknownEffect(
  Schema.Tuple([Schema.Struct({ count: Schema.Number })]),
);

const isD1Database = (input: unknown): input is Workers.D1Database =>
  typeof input === "object" && input !== null && "prepare" in input && "batch" in input;

const notFound = HttpServerResponse.text("Not Found", { status: 404 });

const make = <R>(options: AuthOptions<R>) =>
  Effect.gen(function* () {
    const authOrigin = yield* Config.option(Config.String(SITE_AUTH_ENV.authOrigin)).pipe(
      Effect.orDie,
    );
    if (isAlchemyRuntime() && Option.isNone(authOrigin))
      return yield* Effect.die(
        new Error(`${SITE_AUTH_ENV.authOrigin} is not bound to the Backend`),
      );
    const dailyCap = yield* Config.option(
      Config.schema(SignInCodeDailyCap, SITE_AUTH_ENV.dailyCap),
    ).pipe(Effect.orDie);
    if (isAlchemyRuntime() && Option.isNone(dailyCap))
      return yield* Effect.die(new Error(`${SITE_AUTH_ENV.dailyCap} is not bound to the Backend`));
    const capped = Option.contains(dailyCap, "on");
    const database = yield* BetterAuthDatabase;
    const context = yield* Effect.context<R>();
    const runPromise = Effect.runPromiseWith(context);
    const run: RunHook<R> = (effect) =>
      runPromise(effect.pipe(Effect.scoped, Effect.provide(RuntimeContext.phantom)));

    const mayCreate = (address: unknown) =>
      Option.match(decodeEmail(address), {
        onNone: () => Effect.succeed(false),
        onSome: options.signUp,
      });

    const appHooks = options.databaseHooks?.(run) ?? {};
    const appBefore = appHooks.user?.create?.before;

    const betterAuth = yield* BetterAuth({
      ...(options.secret === undefined ? {} : { secret: options.secret }),
      migrate: false,
      basePath: AUTH_BASE_PATH,
      baseURL: Option.getOrUndefined(authOrigin),
      user: {
        validateUserInfo: ({ user }) =>
          run(
            Effect.map(mayCreate(user.email), (may) =>
              may ? undefined : { error: "not_invited" },
            ),
          ),
      },
      databaseHooks: {
        ...appHooks,
        user: {
          ...appHooks.user,
          create: {
            ...appHooks.user?.create,
            before: async (user, endpoint) => {
              if (!(await run(mayCreate(user.email)))) return false;
              return appBefore?.(user, endpoint);
            },
          },
        },
      },
      plugins: [
        emailOTP({
          otpLength: SIGN_IN_CODE_LENGTH,
          expiresIn: Duration.toSeconds(SIGN_IN_CODE_TTL),
          allowedAttempts: SIGN_IN_CODE_ATTEMPTS,
          storeOTP: "hashed",
          sendVerificationOTP: ({ type }) =>
            run(
              Effect.die(
                new Error(`Better Auth asked to send a ${type} code: codes go through the Backend`),
              ),
            ),
        }),
        admin(),
      ],
      advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
      logger: {
        // An extra argument would turn the message into an array, which Workers Logs stores with
        // the Error dropped: the Error becomes the log's cause, anything else `detail`.
        log: (level, message, ...args: readonly unknown[]) => {
          const error = args.find((arg) => arg instanceof Error);
          const detail = args.filter((arg) => arg !== error);
          void runPromise(
            Effect.logWithLevel(
              REFUSED_TARGET.test(message) ? "Warn" : BETTER_AUTH_SEVERITY[level],
            )(`[Better Auth] ${message}`, ...(error === undefined ? [] : [Cause.die(error)])).pipe(
              Effect.annotateLogs(detail.length === 0 ? {} : { detail }),
            ),
          );
        },
      },
      rateLimit: { enabled: false },
    });

    const instance = betterAuth.auth.pipe(Effect.provide(RuntimeContext.phantom));

    const serve = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const { pathname } = new URL(request.url, "http://backend");
      if (!isAuthEndpoint(request.method, pathname)) return notFound;
      return yield* betterAuth.fetch.pipe(Effect.provide(RuntimeContext.phantom), Effect.orDie);
    });

    const session = Effect.fn("Auth.session")(function* (cookie: string | undefined) {
      const found = yield* betterAuth.getSession(new Headers({ cookie: cookie ?? "" })).pipe(
        Effect.provide(RuntimeContext.phantom),
        Effect.mapError(() => new UnauthorizedError()),
      );
      if (found === null) return yield* new UnauthorizedError();
      const user = yield* decodeSiteUser({
        id: found.user.id,
        email: found.user.email,
        role: found.user.role,
      }).pipe(Effect.mapError(() => new UnauthorizedError()));
      const expiresAt = yield* decodeExpiresAt(found.session.expiresAt).pipe(
        Effect.mapError(() => new UnauthorizedError()),
      );
      return { user, sessionId: found.session.id, expiresAt } satisfies SiteSession;
    });

    const internalAdapter = Effect.map(
      Effect.flatMap(instance, (auth) => Effect.promise(() => auth.$context)),
      (authContext) => authContext.internalAdapter,
    );

    const userExists = Effect.fnUntraced(function* (email: Email) {
      const adapter = yield* internalAdapter;
      return (yield* Effect.promise(() => adapter.findUserByEmail(email))) !== null;
    });

    const maySignIn = Effect.fn("Auth.maySignIn")(function* (email: Email) {
      return (yield* userExists(email)) || (yield* Effect.provide(options.signUp(email), context));
    });

    const issueSignInCode = Effect.fn("Auth.issueSignInCode")(function* (email: Email) {
      // Better Auth checks a code against the address's newest row, which two codes issued in
      // one millisecond leave ambiguous, so only the newest code is ever stored.
      const adapter = yield* internalAdapter;
      yield* Effect.promise(() => adapter.deleteVerificationByIdentifier(`sign-in-otp-${email}`));
      const code = yield* betterAuth.api
        .createVerificationOTP({ body: { email, type: "sign-in" } })
        .pipe(Effect.provide(RuntimeContext.phantom), Effect.orDie);
      return yield* decodeSignInCode(code).pipe(Effect.orDie);
    });

    const d1 = database.runtime.pipe(
      Effect.flatMap((input) =>
        isD1Database(input)
          ? Effect.succeed(input)
          : Effect.die(new Error("Auth's daily cap needs a D1 database")),
      ),
      Effect.provide(RuntimeContext.phantom),
      Effect.scoped,
    );

    const admitCodeRequest = Effect.fn("Auth.admitCodeRequest")(function* (email: Email) {
      if (!capped) return true;
      const dayStartAt = DateTime.toEpochMillis(DateTime.startOf(yield* DateTime.now, "day"));
      const db = yield* d1;
      const [, counted] = yield* Effect.promise(() =>
        db.batch<{ readonly count: number }>([
          db.prepare("delete from SignInCodeCount where dayStartAt < ?").bind(dayStartAt),
          db
            .prepare(
              "insert into SignInCodeCount (dayStartAt, email, count) values (?, ?, 1) on conflict (dayStartAt, email) do update set count = count + 1 returning count",
            )
            .bind(dayStartAt, email),
        ]),
      );
      const [{ count }] = yield* decodeCounted(counted?.results).pipe(Effect.orDie);
      return count <= SIGN_IN_CODES_PER_DAY;
    });

    return { serve, session, maySignIn, admitCodeRequest, issueSignInCode } satisfies AuthShape;
  });

/**
 * Site sign-in: Better Auth with email OTP and the admin plugin, over the Better Auth `Database`
 * in context (`CloudflareD1(database)` in a Worker), on the tables of the package's
 * `0000_sac_02_better_auth.sql`. A user is created only on a first sign-in the app's
 * {@link SignUpRule} admits, always with the role `user`; an admin is a user the stage's seed
 * writes with the role `admin`. Codes are {@link SIGN_IN_CODE_LENGTH} digits and stored hashed;
 * only an address's newest code is valid, for {@link SIGN_IN_CODE_TTL} and
 * {@link SIGN_IN_CODE_ATTEMPTS} wrong guesses. Better Auth sends nothing itself: the Backend's
 * `requestSignInCode` issues a code and hands it to `SignInCodeDelivery`.
 */
export class Auth extends Context.Service<Auth, AuthShape>()("app/Auth") {
  static readonly layer = <R = never>(
    options: AuthOptions<R>,
  ): Layer.Layer<Auth, never, R | BetterAuthDatabase> => Layer.effect(Auth, make(options));
}
