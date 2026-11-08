import { ShopDomain } from "../internal/domain.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
/** The shop id the fake's GraphQL endpoint answers when nothing is scripted. */
export declare const FAKE_SHOP_GID = "gid://shopify/Shop/0";
/** The scopes an unscripted grant reports. */
export declare const FAKE_SCOPE = "read_products";
/** The access token lifetime an unscripted grant reports, in seconds: Shopify's hour. */
export declare const FAKE_ACCESS_TOKEN_EXPIRES_IN = 3600;
/** The refresh token lifetime an unscripted grant reports, in seconds: Shopify's 90 days. */
export declare const FAKE_REFRESH_TOKEN_EXPIRES_IN = 7776000;
/** The `grant_type` of a token exchange, as the library sends it. */
export declare const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
/** The `grant_type` of a refresh. */
export declare const REFRESH_GRANT = "refresh_token";
/** The two endpoints the library reaches: the token endpoint and Admin GraphQL. */
export declare const ShopifyFakeRoute: Schema.Literals<readonly ["token", "graphql"]>;
export type ShopifyFakeRoute = typeof ShopifyFakeRoute.Type;
/**
 * One scripted reply, data only, so a test process can send it to a test Backend. A body is
 * `body` as JSON, or `text` as it is (an outage page that is not JSON); `networkError` answers
 * no response at all, `delayMs` answers late, and `hang` never answers, so the grant's attempt
 * deadline abandons it.
 */
export declare const ShopifyFakeReply: Schema.Struct<{
  readonly route: Schema.Literals<readonly ["token", "graphql"]>;
  readonly status: Schema.optional<Schema.Number>;
  readonly body: Schema.optional<Schema.Unknown>;
  readonly text: Schema.optional<Schema.String>;
  readonly networkError: Schema.optional<Schema.Boolean>;
  readonly delayMs: Schema.optional<Schema.Number>;
  readonly hang: Schema.optional<Schema.Boolean>;
}>;
export type ShopifyFakeReply = typeof ShopifyFakeReply.Type;
/**
 * One HTTP call the library made, as the fake saw it. The refresh token is the presented one: a
 * fake's tokens are labels, never credentials.
 */
export declare const ShopifyFakeCall: Schema.Struct<{
  readonly route: Schema.Literals<readonly ["token", "graphql"]>;
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly grantType: Schema.optional<Schema.String>;
  readonly refreshToken: Schema.optional<Schema.String>;
}>;
export type ShopifyFakeCall = typeof ShopifyFakeCall.Type;
/**
 * In-process only, since a function is not data: decides a call's reply, given the call, its
 * index among every call, and `answer`, which yields what the fake would have answered (a script,
 * else the ledger). A test gates a grant by awaiting its own signal before `answer`.
 */
export type ShopifyFakeIntercept = (call: ShopifyFakeCall, attempt: number, answer: () => Promise<Response>) => Response | Promise<Response>;
/** A token endpoint success body, Shopify's shape; `over` replaces or, with `undefined`, drops a field. */
export declare const grantBody: (over?: Record<string, unknown>) => {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
};
declare const ShopifyFake_base: Context.ServiceClass<ShopifyFake, "app/ShopifyFake", {
  /** Queues `replies`, each on its route, after any still queued; each answers one call. */
  script: (replies: readonly ShopifyFakeReply[]) => Effect.Effect<void, never, never>;
  /** In-process only: `decide` answers every call from now on; `undefined` stops it. */
  intercept: (decide: ShopifyFakeIntercept | undefined) => Effect.Effect<void, never, never>;
  /** Every call served since the fake was installed, in order. */
  calls: Effect.Effect<readonly {
    readonly route: "graphql" | "token";
    readonly shop: string & import("effect/Brand").Brand<"ShopDomain">;
    readonly grantType?: string | undefined;
    readonly refreshToken?: string | undefined;
  }[], never, never>;
  /** Marks `refreshToken` usable for `shop`, as a token Shopify issued before the fake started. */
  recognize: (shop: ShopDomain, refreshToken: string) => Effect.Effect<void, never, never>;
  /**
   * Whether Shopify would accept `refreshToken` for `shop` now: the invariant every
   * concurrency test ends on, held against the stored refresh token.
   */
  accepts: (shop: ShopDomain, refreshToken: string | null) => Effect.Effect<boolean, never, never>;
  /**
   * Forgets every script, call, intercept and issued token, as a fresh fake would: a test
   * Backend keeps one fake for its isolate's life and resets it between cases.
   */
  reset: Effect.Effect<void, never, never>;
}>;
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
export declare class ShopifyFake extends ShopifyFake_base {
  static readonly layer: Layer.Layer<ShopifyFake, never, never>;
}
export {};