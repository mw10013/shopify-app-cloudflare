/**
 * Requesting a sign-in code: the rate limit, the delivery the stage chose, the mail, and the
 * Backend methods and control door procedure over them.
 *
 * @module
 */

import * as Cloudflare from "@alchemy.run/cloudflare";
import { RuntimeContext } from "alchemy";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { SignInCodeDeliveryMode, SITE_AUTH_ENV } from "./bindings.ts";
import { isAlchemyRuntime } from "./shopify-client.ts";
import {
  type Email,
  RequestInfo,
  SIGN_IN_CODE_TTL,
  type SignInCode,
  SignInCodeRequest,
  SignInCodeRequested,
  SiteAuthControlRpcs,
  SiteUser,
  TooManyRequestsError,
  UnauthorizedError,
} from "./site-auth-contract.ts";
import { Auth } from "./site-auth.ts";

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The mail {@link Mailer.layerTest} has sent, in order. */
export class SentMail extends Context.Service<SentMail, Ref.Ref<readonly Mail[]>>()(
  "app/SentMail",
) {
  static readonly layer = Layer.effect(SentMail, Ref.make<readonly Mail[]>([]));
}

/**
 * Sends transactional mail. A send failure is a defect: the caller cannot do anything about it
 * and must not tell the visitor.
 */
export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (mail: Mail) => Effect.Effect<void> }
>()("app/Mailer") {
  /**
   * Over the app's Email Service binding (`Cloudflare.Email.SendEmail`), from `from`, an address
   * on its sending domain. Yielding the binding attaches it to the Worker, so the layer is built
   * in the Worker's init.
   */
  static readonly layer = (
    sender: Effect.Effect<Cloudflare.Email.SendEmail>,
    options: { readonly from: string },
  ) =>
    Layer.effect(
      Mailer,
      Effect.gen(function* () {
        const email = yield* Cloudflare.Email.Send(sender);
        return Mailer.of({
          send: (mail) =>
            email
              .send({ from: options.from, ...mail })
              .pipe(Effect.asVoid, Effect.orDie, Effect.provide(RuntimeContext.phantom)),
        });
      }),
    );

  /** Records mail in {@link SentMail} instead of sending it. */
  static readonly layerTest = Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const sent = yield* SentMail;
      return Mailer.of({ send: (mail) => Ref.update(sent, (mails) => [...mails, mail]) });
    }),
  ).pipe(Layer.provideMerge(SentMail.layer));
}

const minutes = Duration.toMinutes(SIGN_IN_CODE_TTL);

const codeMail = (appName: string, to: Email, code: SignInCode): Mail => ({
  to,
  subject: `${code} is your ${appName} sign-in code`,
  text: `Your ${appName} sign-in code is ${code}.\n\nIt expires in ${String(minutes)} minutes. If you did not ask for it, ignore this email.`,
  html: `<p>Your ${appName} sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p><p>It expires in ${String(minutes)} minutes. If you did not ask for it, ignore this email.</p>`,
});

/**
 * Delivers a sign-in code in the stage's {@link SignInCodeDeliveryMode}, answering the code when
 * the caller may see it: Some under `inline`, None under `mailed`.
 */
export class SignInCodeDelivery extends Context.Service<
  SignInCodeDelivery,
  { readonly deliver: (to: Email, code: SignInCode) => Effect.Effect<Option.Option<SignInCode>> }
>()("app/SignInCodeDelivery") {
  /** The code goes back to the caller and nowhere else. The code signs its holder in, so it is never logged. */
  static readonly layerInline = Layer.succeed(
    SignInCodeDelivery,
    SignInCodeDelivery.of({
      deliver: Effect.fn("SignInCodeDelivery.deliver")(function* (to, code) {
        yield* Effect.logDebug(`SignInCodeDelivery.deliver: to=${to} delivery=inline`).pipe(
          Effect.annotateLogs({ to, delivery: "inline" }),
        );
        return Option.some(code);
      }),
    }),
  );

  /** The code is mailed to the address through {@link Mailer}, as from `appName`. */
  static readonly layerMailed = (options: { readonly appName: string }) =>
    Layer.effect(
      SignInCodeDelivery,
      Effect.gen(function* () {
        const mailer = yield* Mailer;
        return SignInCodeDelivery.of({
          deliver: Effect.fn("SignInCodeDelivery.deliver")(function* (to, code) {
            yield* mailer.send(codeMail(options.appName, to, code));
            yield* Effect.logDebug(`SignInCodeDelivery.deliver: to=${to} delivery=mailed`).pipe(
              Effect.annotateLogs({ to, delivery: "mailed" }),
            );
            return Option.none();
          }),
        });
      }),
    );

  /**
   * The mode `bindSiteAuth` binds as `SIGN_IN_CODE_DELIVERY` chooses the layer. It is absent
   * while the stack is planned, when nothing is delivered; a running Worker without it is broken.
   */
  static readonly layerConfig = (options: { readonly appName: string }) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const mode = yield* Config.option(
          Config.schema(SignInCodeDeliveryMode, SITE_AUTH_ENV.delivery),
        ).pipe(Effect.orDie);
        if (isAlchemyRuntime() && Option.isNone(mode))
          return yield* Effect.die(
            new Error(`${SITE_AUTH_ENV.delivery} is not bound to the Backend`),
          );
        return Match.value(Option.getOrElse(mode, (): SignInCodeDeliveryMode => "mailed")).pipe(
          Match.when("inline", () => SignInCodeDelivery.layerInline),
          Match.when("mailed", () => SignInCodeDelivery.layerMailed(options)),
          Match.exhaustive,
        );
      }),
    );
}

/**
 * The sign-in rate limit, over a Cloudflare Rate Limit binding the app declares: a code request
 * counts once against the client's IP and once against the address, each its own key, so neither
 * one client nor one inbox gets unlimited codes. A request with no client IP counts against the
 * address alone.
 */
export class SignInLimiter extends Context.Service<
  SignInLimiter,
  {
    readonly admit: (request: {
      readonly ip: string | undefined;
      readonly email: Email;
    }) => Effect.Effect<boolean>;
  }
>()("app/SignInLimiter") {
  /**
   * Over the app's `Cloudflare.RateLimit(...)`. Yielding the binding attaches it to the Worker, so
   * the layer is built in the Worker's init.
   */
  static readonly layer = <R>(limit: {
    readonly asEffect: () => Effect.Effect<Cloudflare.RateLimitClient, never, R>;
  }) =>
    Layer.effect(
      SignInLimiter,
      Effect.gen(function* () {
        const client = yield* limit.asEffect();
        const admitted = (key: string) =>
          client.limit({ key }).pipe(
            Effect.map(({ success }) => success),
            Effect.orDie,
            Effect.provide(RuntimeContext.phantom),
          );
        return SignInLimiter.of({
          admit: ({ ip, email }) =>
            Effect.map(
              Effect.all(
                [...(ip === undefined ? [] : [admitted(`ip:${ip}`)]), admitted(`email:${email}`)],
                {
                  concurrency: "unbounded",
                },
              ),
              (answers) => answers.every(Boolean),
            ),
        });
      }),
    );

  /**
   * Admits every request. For `alchemy dev`, where requests arrive with no client IP, and tests
   * that are not about the limit.
   */
  static readonly layerNoop = Layer.succeed(
    SignInLimiter,
    SignInLimiter.of({ admit: () => Effect.succeed(true) }),
  );
}

const decodeRequestInfo = Schema.decodeUnknownEffect(RequestInfo);
const decodeSignInCodeRequest = Schema.decodeUnknownEffect(SignInCodeRequest);
const encodeSignInCodeRequested = Schema.encodeEffect(SignInCodeRequested);
const encodeSiteUser = Schema.encodeEffect(SiteUser);

/**
 * The sign-in page's Backend methods, each taking the server function's plain arguments: a value
 * that does not decode is a defect, as the server function already validated it. Serve them with
 * {@link signInFailures}.
 *
 * - `requestSignInCode` applies {@link SignInLimiter}, then issues a code only when the address
 *   may sign in and hands it to {@link SignInCodeDelivery}. Anyone else gets the same answer
 *   without a code, so the page never learns who may sign in.
 * - `signedInUser` is the session's user, or `UnauthorizedError`.
 *
 * @example
 * ```ts
 * serveAll(yield* signInMethods, signInFailures);
 * ```
 */
export const signInMethods = Effect.gen(function* () {
  const auth = yield* Auth;
  const delivery = yield* SignInCodeDelivery;
  const limiter = yield* SignInLimiter;
  return {
    requestSignInCode: Effect.fn("Backend.requestSignInCode")(function* (
      request: RequestInfo,
      payload: SignInCodeRequest,
    ) {
      const { ip } = yield* decodeRequestInfo(request).pipe(Effect.orDie);
      const { email } = yield* decodeSignInCodeRequest(payload).pipe(Effect.orDie);
      if (!(yield* limiter.admit({ ip, email }))) {
        yield* Effect.logInfo("Backend.requestSignInCode: status=limited").pipe(
          Effect.annotateLogs({ status: "limited" }),
        );
        return yield* new TooManyRequestsError();
      }
      if (!(yield* auth.maySignIn(email))) {
        yield* Effect.logInfo("Backend.requestSignInCode: status=refused").pipe(
          Effect.annotateLogs({ status: "refused" }),
        );
        return yield* encodeSignInCodeRequested({ code: Option.none() }).pipe(Effect.orDie);
      }
      const code = yield* delivery.deliver(email, yield* auth.issueSignInCode(email));
      return yield* encodeSignInCodeRequested({ code }).pipe(Effect.orDie);
    }),
    signedInUser: Effect.fn("Backend.signedInUser")(function* (request: RequestInfo) {
      const { cookie } = yield* decodeRequestInfo(request).pipe(Effect.orDie);
      const { user } = yield* auth.session(cookie);
      return yield* encodeSiteUser(user).pipe(Effect.orDie);
    }),
  };
});

/** The failures {@link signInMethods} declares, for `serveAll`'s table. */
export const signInFailures = {
  requestSignInCode: TooManyRequestsError,
  signedInUser: UnauthorizedError,
};

/**
 * {@link SiteAuthControlRpcs}' handlers, for an app's control door. `IssueSignInCode` issues a
 * code for an address that may sign in and answers it in the same call, never delivered: a test
 * runner on a stage that mails codes signs in with it through the same check a mailed code
 * takes. It skips the rate limit; an address that could not sign in is a defect.
 */
export const siteAuthControlHandlers = SiteAuthControlRpcs.toLayer(
  Effect.gen(function* () {
    const auth = yield* Auth;
    return SiteAuthControlRpcs.of({
      IssueSignInCode: ({ email }) =>
        Effect.gen(function* () {
          if (!(yield* auth.maySignIn(email)))
            return yield* Effect.die(new Error(`${email} may not sign in`));
          return { code: yield* auth.issueSignInCode(email) };
        }),
    });
  }),
);
