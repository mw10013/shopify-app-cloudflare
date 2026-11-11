/**
 * `AppTokens`: Admin API access tokens from Shopify's application-only grant, a
 * `client_credentials` request with a signed ES256 JWT client assertion. No merchant, no client
 * secret and no refresh token.
 *
 * @module
 */

// Registers the library's runtime fetch, the one HTTP seam the fakes under `/test` patch.
import "@shopify/shopify-api/adapters/web-api";
import { abstractFetch } from "@shopify/shopify-api/runtime";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { importAppTokenKey, signAssertion } from "./app-token-assertion.ts";
import { appTokenConfig } from "./bindings.ts";
import { AppNotInstalledError, type ShopifyUnavailableError } from "./contract.ts";
import type { ShopDomain } from "./domain.ts";
import { isAlchemyRuntime, unavailable } from "./shopify-client.ts";

/**
 * One HTTP attempt of a mint. An abandoned attempt needs no settling: whatever it issued retires
 * nothing.
 */
export const MINT_ATTEMPT_DEADLINE = Duration.seconds(5);

/**
 * Retries of a mint that failed transiently, exponential from 500 ms and jittered, about 1.5 s in
 * all. Each retry signs a new assertion, since Shopify accepts a `jti` once.
 */
export const MINT_TRANSIENT_RETRIES = 2;

/** What a mint answers. `expires` is the request's send time plus `expires_in`. */
export interface AppToken {
  readonly accessToken: string;
  readonly expires: DateTime.Utc;
  readonly scope: string;
}

/** The application-only grant's inputs: the client id and the registered key's private half. */
export interface AppTokensOptions {
  readonly clientId: string;
  /** PKCS #8 PEM, P-256. */
  readonly key: Redacted.Redacted;
  /** The `kid` the key's public JWK is registered under in the Dev Dashboard. */
  readonly kid: string;
}

export interface AppTokensShape {
  /**
   * One application-only token for `shop`. It stores nothing; its callers write. Concurrent
   * mints are harmless: Shopify answers them one token.
   */
  readonly mint: (
    shop: ShopDomain,
  ) => Effect.Effect<AppToken, AppNotInstalledError | ShopifyUnavailableError>;
}

/** A mint attempt that may succeed if tried again. Never leaves this module. */
class MintTransientError extends Data.TaggedError("MintTransientError")<{
  readonly reason: string;
  readonly httpStatus?: number | undefined;
  readonly cause?: unknown;
}> {}

const MintResponse = Schema.fromJsonString(
  Schema.Struct({
    access_token: Schema.NonEmptyString,
    expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
    scope: Schema.String,
  }),
);
const decodeMintResponse = Schema.decodeUnknownEffect(MintResponse);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeErrorField = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }));

/** Logs `AppTokens.mint: shop=<shop> status=<status>`, with the response's `x-request-id`. */
const logMint = (
  log: (message: string) => Effect.Effect<void>,
  shop: ShopDomain,
  status: string,
  detail: Record<string, string | number>,
) =>
  log(
    [
      `AppTokens.mint: shop=${shop} status=${status}`,
      ...Object.entries(detail).map(([key, value]) => `${key}=${String(value)}`),
    ].join(" "),
  ).pipe(Effect.annotateLogs({ shop, status, ...detail }));

const make = (options: AppTokensOptions) =>
  Effect.gen(function* () {
    const signer = {
      clientId: options.clientId,
      kid: options.kid,
      key: yield* importAppTokenKey(options.key),
    };

    /**
     * One request, signed afresh. `redirect: "manual"`, since workerd refuses `"error"`; a 3xx is
     * then a status like any other.
     */
    const attempt = Effect.fnUntraced(function* (shop: ShopDomain) {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: options.clientId,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: yield* signAssertion(signer, shop),
      });
      const sentAt = yield* DateTime.now;
      const { status, text, requestId } = yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await abstractFetch(`https://${shop}/admin/oauth/access_token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: body.toString(),
            redirect: "manual",
            signal,
          });
          return {
            status: response.status,
            text: await response.text(),
            requestId: response.headers.get("x-request-id") ?? "none",
          };
        },
        catch: (cause) => new MintTransientError({ reason: "no-response", cause }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: MINT_ATTEMPT_DEADLINE,
          orElse: () => Effect.fail(new MintTransientError({ reason: "deadline" })),
        }),
      );
      const detail = { httpStatus: status, requestId };
      if (status >= 200 && status < 300) {
        // The body may hold a token, so the defect carries none of it.
        const minted = yield* decodeMintResponse(text).pipe(
          Effect.tapError(() => logMint(Effect.logError, shop, "undecodable", detail)),
          Effect.mapError(() => new Error("the application-only grant's answer does not decode")),
          Effect.orDie,
        );
        return {
          accessToken: minted.access_token,
          expires: DateTime.addDuration(sentAt, Duration.seconds(minted.expires_in)),
          scope: minted.scope,
        } satisfies AppToken;
      }
      const json = decodeJson(text);
      const error = Option.getOrElse(
        Option.map(Option.flatMap(json, decodeErrorField), (field) => field.error),
        () => "none",
      );
      if (status === 404 || (status === 400 && error === "app_not_installed")) {
        yield* logMint(Effect.logInfo, shop, "not-installed", { ...detail, error });
        return yield* new AppNotInstalledError({ shop });
      }
      if (Option.isNone(json))
        return yield* new MintTransientError({ reason: "non-json", httpStatus: status });
      if (status === 429 || status >= 500)
        return yield* new MintTransientError({ reason: "retriable-status", httpStatus: status });
      yield* logMint(Effect.logError, shop, "refused", { ...detail, error });
      return yield* Effect.die(
        new Error(
          status === 401
            ? "the application-only grant answered 401: SHOPIFY_APP_TOKEN_KEY is not registered, or SHOPIFY_APP_TOKEN_KID is wrong"
            : `the application-only grant answered ${String(status)} ${error}`,
        ),
      );
    });

    const mint = Effect.fn("AppTokens.mint")(function* (shop: ShopDomain) {
      return yield* attempt(shop).pipe(
        Effect.retry({
          schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
          times: MINT_TRANSIENT_RETRIES,
          while: (failure) => failure._tag === "MintTransientError",
        }),
        Effect.catchTag("MintTransientError", (failure) =>
          unavailable("AppTokens.mint", shop, failure.reason, {
            httpStatus: failure.httpStatus,
            cause: failure.cause,
          }),
        ),
      );
    });

    return { mint } satisfies AppTokensShape;
  });

/** Application-only tokens by shop: the only way the package gets an Admin API token. */
export class AppTokens extends Context.Service<AppTokens, AppTokensShape>()("app/AppTokens") {
  /** Given the client id, the key and its `kid`; the key is imported as the layer builds. */
  static readonly layer = (options: AppTokensOptions) => Layer.effect(AppTokens, make(options));

  /**
   * Over `SHOPIFY_API_KEY`, `SHOPIFY_APP_TOKEN_KEY` and `SHOPIFY_APP_TOKEN_KID`, which the stack
   * binds to the Backend. Absent while the stack is planned, when nothing mints; a running
   * Worker without one, or with a key that does not import, fails its startup naming it.
   */
  static readonly layerConfig = Layer.unwrap(
    Effect.gen(function* () {
      const { clientId, key, kid } = yield* appTokenConfig;
      if (Option.isSome(clientId) && Option.isSome(key) && Option.isSome(kid))
        return AppTokens.layer({ clientId: clientId.value, key: key.value, kid: kid.value });
      const unbound = new Error(
        `${[
          ...(Option.isNone(clientId) ? ["SHOPIFY_API_KEY"] : []),
          ...(Option.isNone(key) ? ["SHOPIFY_APP_TOKEN_KEY"] : []),
          ...(Option.isNone(kid) ? ["SHOPIFY_APP_TOKEN_KID"] : []),
        ].join(", ")} not bound`,
      );
      if (isAlchemyRuntime()) return yield* Effect.die(unbound);
      return Layer.succeed(AppTokens, { mint: () => Effect.die(unbound) });
    }),
  );
}
