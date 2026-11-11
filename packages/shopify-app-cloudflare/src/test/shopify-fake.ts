/**
 * `ShopifyFake`: the one fake of Shopify's HTTP. Its token endpoint answers the application-only
 * grant as Shopify does, verifying each client assertion against a registered public key; its
 * Admin GraphQL accepts only tokens it issued. It answers scripted replies first, and injects
 * latency, hangs and network errors. It runs in Node and in workerd, so an in-process test and a
 * test Backend fake Shopify the same way.
 *
 * @module
 */

import { abstractFetch, setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ShopDomain } from "#internal/domain.ts";

import { FAKE_APP_TOKEN_KEY, FAKE_APP_TOKEN_KID, FAKE_SHOPIFY_API_KEY } from "./fake-app.ts";

/** The shop id the fake's GraphQL endpoint answers when nothing is scripted. */
export const FAKE_SHOP_GID = "gid://shopify/Shop/0";

/** The scopes an unscripted mint reports. */
export const FAKE_SCOPE = "read_products";

/** The lifetime of a token the fake issues, in seconds: what Shopify answered (measured). */
export const FAKE_ACCESS_TOKEN_EXPIRES_IN = 3599;

/** The longest an assertion may live, `exp` after `iat`: Shopify's 300 s. */
const ASSERTION_MAX_LIFETIME_S = 300;

/** The two endpoints the package reaches: the token endpoint and Admin GraphQL. */
export const ShopifyFakeRoute = Schema.Literals(["token", "graphql"]);
export type ShopifyFakeRoute = typeof ShopifyFakeRoute.Type;

/**
 * One scripted reply, data only, so a test process can send it to a test Backend. A body is
 * `body` as JSON, or `text` as it is (an outage page that is not JSON); `networkError` answers
 * no response at all, `delayMs` answers late, and `hang` never answers, so the mint's attempt
 * deadline abandons it.
 */
export const ShopifyFakeReply = Schema.Struct({
  route: ShopifyFakeRoute,
  status: Schema.optional(Schema.Number),
  body: Schema.optional(Schema.Unknown),
  text: Schema.optional(Schema.String),
  networkError: Schema.optional(Schema.Boolean),
  delayMs: Schema.optional(Schema.Number),
  hang: Schema.optional(Schema.Boolean),
});
export type ShopifyFakeReply = typeof ShopifyFakeReply.Type;

/**
 * One HTTP call, as the fake saw it: a mint's assertion `jti` and form `fields`, an Admin call's
 * `accessToken`. A fake's tokens are labels, never credentials.
 */
export const ShopifyFakeCall = Schema.Struct({
  route: ShopifyFakeRoute,
  shop: ShopDomain,
  jti: Schema.optional(Schema.String),
  fields: Schema.optional(Schema.Array(Schema.String)),
  accessToken: Schema.optional(Schema.String),
});
export type ShopifyFakeCall = typeof ShopifyFakeCall.Type;

/**
 * In-process only, since a function is not data: decides a call's reply, given the call, its
 * index among every call, and `answer`, which yields what the fake would have answered (a script,
 * else Shopify's behavior). A test gates a mint by awaiting its own signal before `answer`.
 */
export type ShopifyFakeIntercept = (
  call: ShopifyFakeCall,
  attempt: number,
  answer: () => Promise<Response>,
) => Response | Promise<Response>;

const decodeShop = Schema.decodeUnknownOption(ShopDomain);
const decodeHeader = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ alg: Schema.String, kid: Schema.String })),
);
const decodeClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      iss: Schema.String,
      sub: Schema.String,
      aud: Schema.String,
      iat: Schema.Number,
      exp: Schema.Number,
      jti: Schema.String,
    }),
  ),
);
const decodeSegment = (segment: string) =>
  Result.getOrElse(Base64Url.decodeString(segment), () => "");

const TOKEN_PATH = "/admin/oauth/access_token";
const GRAPHQL_PATH = /^\/admin\/api\/[^/]+\/graphql\.json$/u;

const routeOf = (pathname: string): Option.Option<ShopifyFakeRoute> =>
  pathname === TOKEN_PATH
    ? Option.some("token")
    : GRAPHQL_PATH.test(pathname)
      ? Option.some("graphql")
      : Option.none();

const unscripted = (reason: string) => Response.json({ error: reason }, { status: 599 });
const refused = (status: number, error: string) => Response.json({ error }, { status });

const ES256 = { name: "ECDSA", namedCurve: "P-256" };

/** The public half of a PKCS #8 P-256 PEM, as Shopify holds a registered JWK. */
const publicKeyOf = async (pem: string) => {
  const der = Base64.decode(pem.replaceAll(/-----[^-]+-----|\s/gu, ""));
  if (Result.isFailure(der)) throw new Error("ShopifyFake: the key is not a PEM");
  const {
    d: _private,
    key_ops: _ops,
    ...jwk
  } = await crypto.subtle.exportKey(
    "jwk",
    await crypto.subtle.importKey("pkcs8", new Uint8Array(der.success), ES256, true, ["sign"]),
  );
  return crypto.subtle.importKey("jwk", jwk, ES256, false, ["verify"]);
};

/** A token the fake issued, when, and under which registered key. */
interface Issued {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly kid: string | undefined;
}

const MINUTE_MS = 60_000;

const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const now = () => clock.currentTimeMillisUnsafe();
  const fakeKey = yield* Effect.promise(() => publicKeyOf(FAKE_APP_TOKEN_KEY));

  const keys = new Map<string, CryptoKey>();
  const installed = new Map<ShopDomain, string>();
  const tokens = new Map<ShopDomain, readonly Issued[]>();
  const usedJtis = new Set<string>();
  const queues: Record<ShopifyFakeRoute, ShopifyFakeReply[]> = { token: [], graphql: [] };
  const calls: ShopifyFakeCall[] = [];
  let issued = 0;
  let intercept: ShopifyFakeIntercept | undefined;

  const start = () => {
    keys.clear();
    keys.set(FAKE_APP_TOKEN_KID, fakeKey);
    installed.clear();
    tokens.clear();
    usedJtis.clear();
    queues.token.length = 0;
    queues.graphql.length = 0;
    calls.length = 0;
    issued = 0;
    intercept = undefined;
  };
  start();

  const tokensOf = (shop: ShopDomain) => tokens.get(shop) ?? [];
  const accepts = (shop: ShopDomain, accessToken: string | null) =>
    accessToken !== null &&
    installed.has(shop) &&
    tokensOf(shop).some((token) => token.accessToken === accessToken && now() < token.expiresAt);

  const replyWith = async (reply: ShopifyFakeReply): Promise<Response> => {
    if (reply.hang === true)
      return new Promise<never>(() => {
        // Never settles: the mint's attempt deadline abandons the call.
      });
    if (reply.delayMs !== undefined) {
      const { delayMs } = reply;
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
    if (reply.networkError === true) throw new TypeError("fetch failed");
    const status = reply.status ?? 200;
    return reply.text === undefined
      ? Response.json(reply.body ?? {}, { status })
      : new Response(reply.text, { status });
  };

  /**
   * Rules 2 and 7: a key the fake holds, a valid signature, `iss` and `sub` the client id, `aud`
   * the shop's token endpoint, a live window of at most 300 s, and a `jti` never seen. Answers
   * the key's `kid`, or `undefined` when the assertion fails.
   */
  const verifyAssertion = async (shop: ShopDomain, clientId: string, assertion: string) => {
    const [header = "", claims = "", signature = ""] = assertion.split(".");
    const decodedHeader = decodeHeader(decodeSegment(header));
    const decodedClaims = decodeClaims(decodeSegment(claims));
    const signatureBytes = Base64Url.decode(signature);
    if (
      Option.isNone(decodedHeader) ||
      Option.isNone(decodedClaims) ||
      Result.isFailure(signatureBytes)
    )
      return undefined;
    const key = keys.get(decodedHeader.value.kid);
    if (key === undefined || decodedHeader.value.alg !== "ES256") return undefined;
    const signed = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new Uint8Array(signatureBytes.success),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    const { iss, sub, aud, iat, exp, jti } = decodedClaims.value;
    const seconds = now() / 1000;
    if (
      !signed ||
      iss !== clientId ||
      sub !== clientId ||
      aud !== `https://${shop}${TOKEN_PATH}` ||
      iat > seconds + 5 ||
      exp <= seconds ||
      exp - iat > ASSERTION_MAX_LIFETIME_S ||
      usedJtis.has(jti)
    )
      return undefined;
    usedJtis.add(jti);
    return decodedHeader.value.kid;
  };

  /**
   * Rule 4: the token already issued this minute under `kid`, with its original expiry, else a
   * new one. Each key gets its own.
   */
  const issue = (shop: ShopDomain, kid: string) => {
    const at = now();
    const current = tokensOf(shop).find(
      (token) =>
        token.kid === kid && Math.floor(token.issuedAt / MINUTE_MS) === Math.floor(at / MINUTE_MS),
    );
    if (current !== undefined) return current;
    issued += 1;
    const token = {
      accessToken: `shpat_${String(issued)}`,
      expiresAt: at + FAKE_ACCESS_TOKEN_EXPIRES_IN * 1000,
      issuedAt: at,
      kid,
    };
    tokens.set(shop, [...tokensOf(shop), token]);
    return token;
  };

  /** Rule 2: one way to authenticate, the assertion, so no secret or `Authorization` beside it. */
  const tokenAnswer = async (
    shop: ShopDomain,
    form: URLSearchParams,
    authorization: boolean,
  ): Promise<Response> => {
    const clientId = form.get("client_id") ?? "";
    const assertion = form.get("client_assertion");
    if (
      form.get("grant_type") !== "client_credentials" ||
      form.get("client_assertion_type") !==
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" ||
      assertion === null ||
      authorization ||
      form.has("client_secret") ||
      form.has("scope")
    )
      return refused(400, "invalid_request");
    if (clientId !== FAKE_SHOPIFY_API_KEY) return refused(400, "application_cannot_be_found");
    const kid = await verifyAssertion(shop, clientId, assertion);
    if (kid === undefined) return refused(401, "invalid_client");
    const scope = installed.get(shop);
    if (scope === undefined) return refused(400, "app_not_installed");
    const token = issue(shop, kid);
    return Response.json({
      access_token: token.accessToken,
      scope,
      expires_in: Math.round((token.expiresAt - now()) / 1000),
    });
  };

  const graphqlAnswer = (call: ShopifyFakeCall): Response =>
    accepts(call.shop, call.accessToken ?? null)
      ? Response.json({ data: { shop: { id: FAKE_SHOP_GID } } })
      : Response.json({ errors: "[API] Invalid API key or access token" }, { status: 401 });

  /** What the fake answers `call` when no intercept decides: a scripted reply, else Shopify's. */
  const answer = (call: ShopifyFakeCall, form: URLSearchParams, authorization: boolean) => () => {
    const scripted = queues[call.route].shift();
    if (scripted !== undefined) return replyWith(scripted);
    return call.route === "token"
      ? tokenAnswer(call.shop, form, authorization)
      : Promise.resolve(graphqlAnswer(call));
  };

  const fake = (url: string, init?: RequestInit): Promise<Response> => {
    const target = new URL(url);
    const route = routeOf(target.pathname);
    const shop = decodeShop(target.hostname);
    if (Option.isNone(shop) || Option.isNone(route))
      return Promise.resolve(
        unscripted(`unscripted request to ${target.origin}${target.pathname}`),
      );
    const form = new URLSearchParams(
      route.value === "token" && typeof init?.body === "string" ? init.body : "",
    );
    const jti = Option.map(
      decodeClaims(decodeSegment(form.get("client_assertion")?.split(".")[1] ?? "")),
      (claims) => claims.jti,
    );
    const headers = new Headers(init?.headers);
    const accessToken = headers.get("x-shopify-access-token");
    const authorization = headers.has("authorization");
    const call: ShopifyFakeCall = {
      route: route.value,
      shop: shop.value,
      ...(route.value === "token" ? { fields: [...form.keys()].toSorted() } : {}),
      ...(Option.isSome(jti) ? { jti: jti.value } : {}),
      ...(accessToken === null ? {} : { accessToken }),
    };
    const attempt = calls.length;
    calls.push(call);
    const decide = intercept;
    return decide === undefined
      ? answer(call, form, authorization)()
      : Promise.resolve(decide(call, attempt, answer(call, form, authorization)));
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const original = abstractFetch;
      setAbstractFetchFunc(fake as typeof abstractFetch);
      return original;
    }),
    (original) =>
      Effect.sync(() => {
        setAbstractFetchFunc(original);
      }),
  );

  return {
    /** Queues `replies`, each on its route, after any still queued; each answers one call. */
    script: (replies: readonly ShopifyFakeReply[]) =>
      Effect.sync(() => {
        for (const reply of replies) queues[reply.route].push(reply);
      }),
    /** In-process only: `decide` answers every call from now on; `undefined` stops it. */
    intercept: (decide: ShopifyFakeIntercept | undefined) =>
      Effect.sync(() => {
        intercept = decide;
      }),
    /** Every call served since the fake was installed or reset, in order. */
    calls: Effect.sync((): readonly ShopifyFakeCall[] => [...calls]),
    /** Installs the app on `shop`, granting `scope`: a mint for it now succeeds. */
    install: (shop: ShopDomain, scope: string = FAKE_SCOPE) =>
      Effect.sync(() => {
        installed.set(shop, scope);
      }),
    /** Uninstalls the app from `shop`: its tokens answer 401 and its mints `app_not_installed`. */
    uninstall: (shop: ShopDomain) =>
      Effect.sync(() => {
        installed.delete(shop);
        tokens.delete(shop);
      }),
    /** Marks `accessToken` as one the fake issued for `shop` earlier, valid until `expiresAt` (epoch ms). */
    recognize: (shop: ShopDomain, accessToken: string, expiresAt: number) =>
      Effect.sync(() => {
        tokens.set(shop, [
          ...tokensOf(shop),
          { accessToken, expiresAt, issuedAt: -Infinity, kid: undefined },
        ]);
      }),
    /**
     * Revokes the registered key `kid` (rule 8): an assertion signed with it answers
     * `401 invalid_client`, and the tokens issued under it answer 401.
     */
    revokeKey: (kid: string) =>
      Effect.sync(() => {
        keys.delete(kid);
        for (const [shop, issuedTokens] of tokens)
          tokens.set(
            shop,
            issuedTokens.filter((token) => token.kid !== kid),
          );
      }),
    /** Whether Shopify would accept `accessToken` for `shop` now. */
    accepts: (shop: ShopDomain, accessToken: string | null) =>
      Effect.sync(() => accepts(shop, accessToken)),
    /**
     * Forgets every script, call, intercept, installation, issued token and used `jti`, and
     * registers the fake app's key again, as a fresh fake would: a test Backend keeps one fake
     * for its isolate's life and resets it between cases.
     */
    reset: Effect.sync(start),
  };
});

/**
 * The fake of Shopify's HTTP. The library's and `AppTokens`' one HTTP seam is the library's
 * module-global fetch, so building {@link ShopifyFake.layer} replaces it for the layer's life and
 * restores it after; two fakes at once in one process would race for it, so a test file builds
 * one at a time.
 *
 * Unscripted, it answers as Shopify does: the token endpoint by rules 2 to 7 of `shopify-auth.md`,
 * for the fake app's client id and its registered key, and Admin GraphQL with
 * {@link FAKE_SHOP_GID} as `shop { id }` for a token it issued and has not retired, 401 for any
 * other. Scripted replies win, one per call, so a test injects 503s, 429s and partial bodies.
 * Any other URL is answered 599 and never reaches the network.
 */
export class ShopifyFake extends Context.Service<ShopifyFake, Effect.Success<typeof make>>()(
  "app/ShopifyFake",
) {
  static readonly layer = Layer.effect(ShopifyFake, make);
}
