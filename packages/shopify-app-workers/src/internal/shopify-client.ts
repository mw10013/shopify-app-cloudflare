/**
 * `ShopifyClient`: the package's one adapter over `@shopify/shopify-api`. No other module builds
 * the library, so the fakes under `/test` patch the one module-global fetch it calls.
 *
 * @module
 */

// Registers the library's runtime adapter (fetch, crypto, headers) for workerd; imported once.
import "@shopify/shopify-api/adapters/web-api";
import {
  ApiVersion,
  GraphqlQueryError,
  HttpMaxRetriesError,
  HttpRequestError,
  HttpResponseError,
  InvalidJwtError,
  LogSeverity,
  Session,
  shopifyApi,
  WebhookValidationErrorReason,
} from "@shopify/shopify-api";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Formatter from "effect/Formatter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  AccessDeniedError,
  InvalidIdTokenError,
  ShopifyUnavailableError,
  ShopInaccessibleError,
} from "./contract.ts";
import { ShopDomain } from "./domain.ts";

/**
 * The Admin API answered 401 to the access token. Never leaves the Admin API call:
 * `Shopify.adminGraphql` retries it once, and the first exchange's `shopGid` fetch fails
 * `ShopifyUnavailableError`.
 */
export class AdminUnauthorizedError extends Data.TaggedError("AdminUnauthorizedError")<{
  readonly shop: ShopDomain;
}> {}

/**
 * `validateWebhook` refused the request: 405 for a method other than POST, 401 for a bad HMAC,
 * 400 for anything else invalid (an empty body, a missing header, a shop domain that is not a
 * {@link ShopDomain}, a body that is not JSON). The caller answers with `status` and nothing else.
 */
export class WebhookRejectedError extends Data.TaggedError("WebhookRejectedError")<{
  readonly status: 400 | 401 | 405;
}> {}

/** A webhook that passed `validateWebhook`. `topic` is the header's form: `app/uninstalled`. */
export interface ValidatedWebhook {
  readonly shop: ShopDomain;
  readonly topic: string;
  readonly payload: unknown;
  readonly webhookId: string;
}

/** The spans whose lines name a Shopify outage. */
export type ShopifySpan = "Shopify.adminGraphql" | "ShopGrantor.exchange" | "ShopGrantor.ensure";

/** The app's credentials, as Shopify CLI or a deployed stage binds them. Scopes are the app configuration's. */
export interface ShopifyCredentials {
  readonly apiKey: string;
  readonly apiSecret: Redacted.Redacted;
  /** The app's URL; its host and scheme are the library's `hostName` and `hostScheme`. */
  readonly appUrl: string;
}

const decodeWebhookShop = Schema.decodeUnknownOption(ShopDomain);
const decodeWebhookPayload = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The claims verified beyond the library's checks, as `decodeSessionToken` returns them. */
const IdTokenClaims = Schema.Struct({
  iss: Schema.URLFromString,
  dest: Schema.URLFromString,
  sub: Schema.optional(Schema.String),
});
const decodeIdTokenClaims = Schema.decodeUnknownOption(IdTokenClaims);
const decodeShop = Schema.decodeUnknownOption(ShopDomain);

/** The `extensions.code` of each GraphQL error in a 200 answer. */
const GraphqlErrorCodes = Schema.Struct({
  errors: Schema.Struct({
    graphQLErrors: Schema.Array(
      Schema.Struct({
        extensions: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
      }),
    ),
  }),
});
const decodeGraphqlErrorCodes = Schema.decodeUnknownOption(GraphqlErrorCodes);

/** Whether `status` is how the Admin API refuses the shop itself. */
const isInaccessibleStatus = (status: number): status is ShopInaccessibleError["status"] =>
  status === 402 || status === 423 || status === 403;

/** A library call that may reject, its rejection kept as the failure. */
export const tryShopify = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause });

/**
 * Logs `<span>: shop=<shop> status=unavailable reason=<reason>` at Warning, with the HTTP status
 * and the cause's message annotated, then fails {@link ShopifyUnavailableError}, which never
 * carries its cause: it crosses to the browser.
 */
export const unavailable = (
  span: ShopifySpan,
  shop: ShopDomain,
  reason: string,
  detail: { readonly httpStatus?: number | undefined; readonly cause?: unknown } = {},
) =>
  Effect.logWarning(`${span}: shop=${shop} status=unavailable reason=${reason}`).pipe(
    Effect.annotateLogs({
      shop,
      status: "unavailable",
      reason,
      ...(detail.httpStatus === undefined ? {} : { httpStatus: detail.httpStatus }),
      ...(detail.cause === undefined
        ? {}
        : {
            cause:
              detail.cause instanceof Error ? detail.cause.message : Formatter.format(detail.cause),
          }),
    }),
    Effect.andThen(Effect.fail(new ShopifyUnavailableError({ shop }))),
  );

const make = (credentials: ShopifyCredentials) =>
  Effect.gen(function* () {
    // Built on first use, so planning the stack, where the bindings are absent, never builds it.
    const library = yield* Effect.cached(
      Effect.sync(() => {
        const { host, protocol } = new URL(credentials.appUrl);
        return shopifyApi({
          apiKey: credentials.apiKey,
          apiSecretKey: Redacted.value(credentials.apiSecret),
          hostName: host,
          hostScheme: protocol === "http:" ? "http" : "https",
          // `ADMIN_API_VERSION`; a unit test holds the two equal.
          apiVersion: ApiVersion.October26,
          isEmbeddedApp: true,
          // Every future flag on, which silences the library's "Future flag X is disabled" log
          // on every isolate start; neither changes a path the package uses.
          future: { customerAddressDefaultFix: true, unstable_managedPricingSupport: true },
          // The library logs its version on every isolate start and each session it creates at
          // Info, one billed event each; its warnings and errors still print.
          logger: { level: LogSeverity.Warning },
        });
      }),
    );

    /**
     * Verifies an ID token: signature, `exp`/`nbf` and `aud` (the library's
     * `decodeSessionToken`), then that the hostnames of `iss` and `dest` match, which the
     * library does not check. The one definition of a valid ID token: every check of one uses
     * it. Answers the shop (`dest`'s host) and `sub`, the staff member, for attribution.
     */
    const decodeIdToken = Effect.fn("ShopifyClient.decodeIdToken")(function* (idToken: string) {
      const shopify = yield* library;
      const payload = yield* tryShopify(() => shopify.session.decodeSessionToken(idToken)).pipe(
        Effect.catch((error) =>
          error instanceof InvalidJwtError
            ? Effect.fail(new InvalidIdTokenError())
            : Effect.die(error),
        ),
      );
      const claims = decodeIdTokenClaims(payload);
      const shop = Option.flatMap(claims, ({ iss, dest }) =>
        iss.hostname === dest.hostname ? decodeShop(dest.hostname) : Option.none(),
      );
      if (Option.isNone(shop) || Option.isNone(claims)) return yield* new InvalidIdTokenError();
      return { shop: shop.value, sub: claims.value.sub };
    });

    /**
     * Classifies a failed Admin API call. A 200 that carries GraphQL errors arrives as
     * `GraphqlQueryError`: `THROTTLED` and `INTERNAL_SERVER_ERROR` are transient, `ACCESS_DENIED`
     * is a scope the shop has not granted, and anything else means the query is wrong.
     */
    const classifyAdminFailure = (
      span: ShopifySpan,
      shop: ShopDomain,
      error: unknown,
    ): Effect.Effect<
      never,
      AdminUnauthorizedError | ShopifyUnavailableError | AccessDeniedError | ShopInaccessibleError
    > => {
      if (error instanceof GraphqlQueryError) {
        const codes: readonly (string | undefined)[] = Option.match(
          decodeGraphqlErrorCodes(error.body),
          {
            onNone: () => [],
            onSome: ({ errors }) => errors.graphQLErrors.map((each) => each.extensions?.code),
          },
        );
        const transient = codes.find(
          (code) => code === "THROTTLED" || code === "INTERNAL_SERVER_ERROR",
        );
        if (transient !== undefined) return unavailable(span, shop, transient);
        if (codes.includes("ACCESS_DENIED")) return Effect.fail(new AccessDeniedError({ shop }));
        return Effect.die(error);
      }
      if (error instanceof HttpResponseError) {
        // `instanceof` narrows the generic class to `HttpResponseError<any>`.
        const code = (error as HttpResponseError).response.code;
        if (code === 401) return Effect.fail(new AdminUnauthorizedError({ shop }));
        if (isInaccessibleStatus(code))
          return Effect.fail(new ShopInaccessibleError({ shop, status: code }));
        if (code === 429 || code >= 500)
          return unavailable(span, shop, "retriable-status", { httpStatus: code, cause: error });
        return Effect.die(error);
      }
      if (error instanceof HttpRequestError || error instanceof HttpMaxRetriesError)
        return unavailable(span, shop, "no-response", { cause: error });
      return Effect.die(error);
    };

    /** One Admin GraphQL call with `accessToken`, its failures classified; `data` undecoded. */
    const adminCall = Effect.fnUntraced(function* (
      span: ShopifySpan,
      shop: ShopDomain,
      accessToken: string,
      query: string,
      variables: Record<string, unknown> | undefined,
    ) {
      const shopify = yield* library;
      const session = new Session({
        id: shopify.session.getOfflineId(shop),
        shop,
        state: "",
        isOnline: false,
        accessToken,
      });
      const client = new shopify.clients.Graphql({ session });
      const { data } = yield* tryShopify(() => client.request<unknown>(query, { variables })).pipe(
        Effect.catch((error) => classifyAdminFailure(span, shop, error)),
      );
      return data;
    });

    /**
     * Verifies a webhook by HMAC over its raw body and parses it, or fails with
     * {@link WebhookRejectedError}. It reads no session: authenticity is the HMAC alone, and a
     * handler that needs the Admin API calls `ensureSession` itself, since a webhook is a trigger
     * to re-query Shopify, not a data feed. `request`'s body is read here, once.
     *
     * Log levels:
     *
     * | Rejection                                              | Level   |
     * | ------------------------------------------------------ | ------- |
     * | A failed HMAC (401)                                    | Error   |
     * | A validated delivery whose shop or body does not decode | Warning |
     * | A non-POST, a missing header (the HMAC's included), any other | Debug |
     *
     * A failed HMAC is an Error because a wrong API secret fails every real delivery, the
     * `app/uninstalled` one included, and nothing else reports it; scanner noise is the cost, and
     * sampling is its fix. A missing HMAC header is a scanner's shape, and Shopify always sends
     * it, so it stays at Debug with the other rejections; a wrong secret still shows as the Error.
     */
    const validateWebhook = Effect.fn("ShopifyClient.validateWebhook")(function* (
      request: Request,
    ) {
      if (request.method !== "POST") {
        yield* Effect.logDebug("ShopifyClient.validateWebhook: httpStatus=405: not a POST").pipe(
          Effect.annotateLogs({ httpStatus: 405, url: request.url, method: request.method }),
        );
        return yield* new WebhookRejectedError({ status: 405 });
      }
      const shopify = yield* library;
      const rawBody = yield* tryShopify(() => request.text()).pipe(Effect.orDie);
      const validation = yield* tryShopify(() =>
        shopify.webhooks.validate({ rawBody, rawRequest: request }),
      ).pipe(Effect.orDie);
      if (!validation.valid) {
        const invalidHmac = validation.reason === WebhookValidationErrorReason.InvalidHmac;
        const httpStatus = invalidHmac ? 401 : 400;
        yield* (invalidHmac ? Effect.logError : Effect.logDebug)(
          `ShopifyClient.validateWebhook: httpStatus=${String(httpStatus)} reason=${validation.reason}`,
        ).pipe(Effect.annotateLogs({ ...validation, httpStatus }));
        return yield* new WebhookRejectedError({ status: httpStatus });
      }
      const shop = decodeWebhookShop(validation.domain);
      const payload = decodeWebhookPayload(rawBody);
      if (Option.isNone(shop) || Option.isNone(payload)) {
        yield* Effect.logWarning(
          `ShopifyClient.validateWebhook: httpStatus=400: the ${Option.isNone(shop) ? "shop domain" : "body"} does not decode`,
        ).pipe(
          Effect.annotateLogs({
            httpStatus: 400,
            topic: validation.topic,
            domain: validation.domain,
          }),
        );
        return yield* new WebhookRejectedError({ status: 400 });
      }
      return {
        shop: shop.value,
        // The library hands on its storage form (`APP_UNINSTALLED`); a handler is keyed by the
        // header's, which the validation just required.
        topic: request.headers.get("x-shopify-topic") ?? validation.topic,
        payload: payload.value,
        webhookId: validation.webhookId,
      } satisfies ValidatedWebhook;
    });

    return { library, decodeIdToken, adminCall, validateWebhook };
  });

/**
 * Whether this code runs in a Worker Alchemy built: its bundler folds the global to `true`. The
 * same check as devkit's `isAlchemyRuntime`, which the package does not depend on at run time.
 */
const isAlchemyRuntime = () =>
  // oxlint-disable-next-line no-underscore-dangle -- the global's name is Alchemy's
  (globalThis as { readonly __ALCHEMY_RUNTIME__?: unknown }).__ALCHEMY_RUNTIME__ === true;

/**
 * The stateless `@shopify/shopify-api` adapter: the library instance, ID token and webhook
 * verification, and one classified Admin API call with a given access token. It holds no token
 * and decides nothing about one: the grantor grants through its `library`, and `Shopify` calls
 * the Admin API through `adminCall` with the stored token.
 */
export class ShopifyClient extends Context.Service<
  ShopifyClient,
  Effect.Success<ReturnType<typeof make>>
>()("app/ShopifyClient") {
  /** Given the API key, API secret and app URL. */
  static readonly layer = (credentials: ShopifyCredentials) =>
    Layer.effect(ShopifyClient, make(credentials));

  /**
   * Over `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL`, which the stack binds to
   * the Backend. They are absent while the stack is planned, when nothing calls Shopify; a
   * running Worker without them is broken.
   */
  static readonly layerConfig = Layer.unwrap(
    Effect.gen(function* () {
      const apiKey = yield* Config.option(Config.String("SHOPIFY_API_KEY"));
      const apiSecret = yield* Config.option(Config.Redacted("SHOPIFY_API_SECRET"));
      const appUrl = yield* Config.option(Config.String("SHOPIFY_APP_URL"));
      if (
        isAlchemyRuntime() &&
        (Option.isNone(apiKey) || Option.isNone(apiSecret) || Option.isNone(appUrl))
      )
        return yield* Effect.die(
          new Error("the Shopify API key, secret and app URL are not bound"),
        );
      return ShopifyClient.layer({
        apiKey: Option.getOrElse(apiKey, () => ""),
        apiSecret: Option.getOrElse(apiSecret, () => Redacted.make("")),
        appUrl: Option.getOrElse(appUrl, () => ""),
      });
    }),
  );
}
