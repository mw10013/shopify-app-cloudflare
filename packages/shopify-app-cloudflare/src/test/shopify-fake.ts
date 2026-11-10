/**
 * `ShopifyFake`: the one fake of Shopify's HTTP. It keeps each shop's tokens as Shopify does,
 * answers scripted replies first, and injects latency, hangs and network errors. It runs in Node
 * and in workerd, so an in-process test and a test Backend fake Shopify the same way.
 *
 * @module
 */

import { abstractFetch, setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ShopDomain } from "#internal/domain.ts";

/** The shop id the fake's GraphQL endpoint answers when nothing is scripted. */
export const FAKE_SHOP_GID = "gid://shopify/Shop/0";

/** The scopes an unscripted grant reports. */
export const FAKE_SCOPE = "read_products";

/** The access token lifetime an unscripted grant reports, in seconds: Shopify's hour. */
export const FAKE_ACCESS_TOKEN_EXPIRES_IN = 3600;

/** The refresh token lifetime an unscripted grant reports, in seconds: Shopify's 90 days. */
export const FAKE_REFRESH_TOKEN_EXPIRES_IN = 7_776_000;

/** The `grant_type` of a token exchange, as the library sends it. */
export const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";

/** The `grant_type` of a refresh. */
export const REFRESH_GRANT = "refresh_token";

/** The two endpoints the library reaches: the token endpoint and Admin GraphQL. */
export const ShopifyFakeRoute = Schema.Literals(["token", "graphql"]);
export type ShopifyFakeRoute = typeof ShopifyFakeRoute.Type;

/**
 * One scripted reply, data only, so a test process can send it to a test Backend. A body is
 * `body` as JSON, or `text` as it is (an outage page that is not JSON); `networkError` answers
 * no response at all, `delayMs` answers late, and `hang` never answers, so the grant's attempt
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
 * One HTTP call the library made, as the fake saw it. The refresh token is the presented one: a
 * fake's tokens are labels, never credentials.
 */
export const ShopifyFakeCall = Schema.Struct({
  route: ShopifyFakeRoute,
  shop: ShopDomain,
  grantType: Schema.optional(Schema.String),
  refreshToken: Schema.optional(Schema.String),
});
export type ShopifyFakeCall = typeof ShopifyFakeCall.Type;

/**
 * In-process only, since a function is not data: decides a call's reply, given the call, its
 * index among every call, and `answer`, which yields what the fake would have answered (a script,
 * else the ledger). A test gates a grant by awaiting its own signal before `answer`.
 */
export type ShopifyFakeIntercept = (
  call: ShopifyFakeCall,
  attempt: number,
  answer: () => Promise<Response>,
) => Response | Promise<Response>;

/** The fields of a token endpoint request the fake reads. */
const TokenRequest = Schema.fromJsonString(
  Schema.Struct({
    grant_type: Schema.optional(Schema.String),
    refresh_token: Schema.optional(Schema.String),
  }),
);
const decodeTokenRequest = Schema.decodeUnknownOption(TokenRequest);
const decodeShop = Schema.decodeUnknownOption(ShopDomain);

const TOKEN_PATH = "/admin/oauth/access_token";
const GRAPHQL_PATH = /^\/admin\/api\/[^/]+\/graphql\.json$/u;

const routeOf = (pathname: string): Option.Option<ShopifyFakeRoute> =>
  pathname === TOKEN_PATH
    ? Option.some("token")
    : GRAPHQL_PATH.test(pathname)
      ? Option.some("graphql")
      : Option.none();

const unscripted = (reason: string) => Response.json({ error: reason }, { status: 599 });

/** Rule 3's limit on a presented refresh token: usable for 30 days after its first use. */
const FIRST_USE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** A usable refresh token's limits: its original expiry, and when it was first presented. */
interface RefreshTokenLife {
  readonly expiresAt: number;
  firstUsedAt?: number;
}

/**
 * One shop's tokens as Shopify keeps them, on the clock `now`. An exchange issues a pair and
 * retires every other refresh token (rule 2). A refresh with a usable token issues a pair; the
 * presented token stays usable until the earliest of its successor being presented, an exchange,
 * 30 days after its first use, or its original expiry (rule 3). Anything else is retired.
 */
const makeLedger = (now: () => number) => {
  let issued = 0;
  const usable = new Map<string, RefreshTokenLife>();
  const predecessor = new Map<string, string>();
  const isUsable = (refreshToken: string) => {
    const life = usable.get(refreshToken);
    if (life === undefined) return false;
    const deadline = Math.min(
      life.expiresAt,
      life.firstUsedAt === undefined ? Infinity : life.firstUsedAt + FIRST_USE_GRACE_MS,
    );
    return now() < deadline;
  };
  /** The shop's next pair: `shpat_<n>` and `shprt_<n>`, counted per shop. */
  const pair = () => {
    issued += 1;
    const refresh = `shprt_${String(issued)}`;
    usable.set(refresh, { expiresAt: now() + FAKE_REFRESH_TOKEN_EXPIRES_IN * 1000 });
    return { access: `shpat_${String(issued)}`, refresh };
  };
  return {
    accepts: (refreshToken: string | null) => refreshToken !== null && isUsable(refreshToken),
    /** A refresh token Shopify issued before the fake started: a seeded row's, issued now. */
    recognize: (refreshToken: string) => {
      usable.set(refreshToken, { expiresAt: now() + FAKE_REFRESH_TOKEN_EXPIRES_IN * 1000 });
    },
    exchange: () => {
      usable.clear();
      return pair();
    },
    /** The next pair for `presented`, or none when Shopify has retired it. */
    refresh: (presented: string) => {
      const life = usable.get(presented);
      if (life === undefined || !isUsable(presented)) return undefined;
      life.firstUsedAt ??= now();
      const before = predecessor.get(presented);
      if (before !== undefined) usable.delete(before);
      const next = pair();
      predecessor.set(next.refresh, presented);
      return next;
    },
  };
};

/** A token endpoint success body, Shopify's shape; `over` replaces or, with `undefined`, drops a field. */
export const grantBody = (over: Record<string, unknown> = {}) => ({
  access_token: "shpat_scripted",
  expires_in: FAKE_ACCESS_TOKEN_EXPIRES_IN,
  refresh_token: "shprt_scripted",
  refresh_token_expires_in: FAKE_REFRESH_TOKEN_EXPIRES_IN,
  scope: FAKE_SCOPE,
  ...over,
});

const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const ledgers = new Map<ShopDomain, ReturnType<typeof makeLedger>>();
  const ledgerOf = (shop: ShopDomain) => {
    const existing = ledgers.get(shop);
    if (existing !== undefined) return existing;
    const ledger = makeLedger(() => clock.currentTimeMillisUnsafe());
    ledgers.set(shop, ledger);
    return ledger;
  };
  const queues: Record<ShopifyFakeRoute, ShopifyFakeReply[]> = { token: [], graphql: [] };
  const calls: ShopifyFakeCall[] = [];
  let intercept: ShopifyFakeIntercept | undefined;

  const replyWith = async (reply: ShopifyFakeReply): Promise<Response> => {
    if (reply.hang === true)
      return new Promise<never>(() => {
        // Never settles: the grant's attempt deadline abandons the call.
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

  const ledgerAnswer = (call: ShopifyFakeCall): Response => {
    if (call.route === "graphql") return Response.json({ data: { shop: { id: FAKE_SHOP_GID } } });
    const ledger = ledgerOf(call.shop);
    const next =
      call.grantType === REFRESH_GRANT
        ? ledger.refresh(call.refreshToken ?? "")
        : call.grantType === TOKEN_EXCHANGE_GRANT
          ? ledger.exchange()
          : undefined;
    return next === undefined
      ? Response.json(
          { error: "invalid_request" },
          { status: call.grantType === REFRESH_GRANT ? 401 : 400 },
        )
      : Response.json(grantBody({ access_token: next.access, refresh_token: next.refresh }));
  };

  /** What the fake answers `call` when no intercept decides: a scripted reply, else the ledger. */
  const answer = (call: ShopifyFakeCall) => () => {
    const scripted = queues[call.route].shift();
    return scripted === undefined ? Promise.resolve(ledgerAnswer(call)) : replyWith(scripted);
  };

  const fake = (url: string, init?: RequestInit): Promise<Response> => {
    const target = new URL(url);
    const route = routeOf(target.pathname);
    const shop = decodeShop(target.hostname);
    if (Option.isNone(shop) || Option.isNone(route))
      return Promise.resolve(
        unscripted(`unscripted request to ${target.origin}${target.pathname}`),
      );
    const request =
      route.value === "token" && typeof init?.body === "string"
        ? decodeTokenRequest(init.body)
        : Option.none();
    const grantType = Option.flatMapNullishOr(request, (body) => body.grant_type);
    const refreshToken = Option.flatMapNullishOr(request, (body) => body.refresh_token);
    const call: ShopifyFakeCall = {
      route: route.value,
      shop: shop.value,
      ...(Option.isSome(grantType) ? { grantType: grantType.value } : {}),
      ...(Option.isSome(refreshToken) ? { refreshToken: refreshToken.value } : {}),
    };
    const attempt = calls.length;
    calls.push(call);
    const decide = intercept;
    return decide === undefined
      ? answer(call)()
      : Promise.resolve(decide(call, attempt, answer(call)));
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
    /** Every call served since the fake was installed, in order. */
    calls: Effect.sync((): readonly ShopifyFakeCall[] => [...calls]),
    /** Marks `refreshToken` usable for `shop`, as a token Shopify issued before the fake started. */
    recognize: (shop: ShopDomain, refreshToken: string) =>
      Effect.sync(() => {
        ledgerOf(shop).recognize(refreshToken);
      }),
    /**
     * Whether Shopify would accept `refreshToken` for `shop` now: the invariant every
     * concurrency test ends on, held against the stored refresh token.
     */
    accepts: (shop: ShopDomain, refreshToken: string | null) =>
      Effect.sync(() => ledgerOf(shop).accepts(refreshToken)),
    /**
     * Forgets every script, call, intercept and issued token, as a fresh fake would: a test
     * Backend keeps one fake for its isolate's life and resets it between cases.
     */
    reset: Effect.sync(() => {
      queues.token.length = 0;
      queues.graphql.length = 0;
      calls.length = 0;
      intercept = undefined;
      ledgers.clear();
    }),
  };
});

/**
 * The fake of Shopify's HTTP. The library's only HTTP seam is one module-global fetch, so
 * building {@link ShopifyFake.layer} replaces it for the layer's life and restores it after; two
 * fakes at once in one process would race for it, so a test file builds one at a time.
 *
 * Unscripted, it answers as Shopify does: the token endpoint from each shop's ledger (spec rules
 * 2 and 3; a retired refresh token is answered `401 invalid_request`), and Admin GraphQL with
 * {@link FAKE_SHOP_GID} as `shop { id }`. Scripted replies win over the ledger, one per call, so
 * a test injects 503s, 429s, `invalid_subject_token` and partial bodies. Any other URL is
 * answered 599 and never reaches the network.
 */
export class ShopifyFake extends Context.Service<ShopifyFake, Effect.Success<typeof make>>()(
  "app/ShopifyFake",
) {
  static readonly layer = Layer.effect(ShopifyFake, make);
}
