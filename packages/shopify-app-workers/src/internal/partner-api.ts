/**
 * `PartnerApi`: the Partner API, billing's one external seam. One query, the shop's app
 * subscription, and the plan selection page's URL.
 *
 * @module
 */

import * as Config from "effect/Config";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { appHandleConfig, type PartnerConfig, partnerConfig } from "./bindings.ts";
import type { ShopifyUnavailableError } from "./contract.ts";
import type { ShopDomain, ShopGid } from "./domain.ts";
import { isAlchemyRuntime, unavailable } from "./shopify-client.ts";
import { PARTNER_API_VERSION } from "./versions.ts";

/** Stand-ins while the stack is planned, when nothing calls the Partner API; they only decode. */
const PLANNING_HANDLE = "planning";
const PLANNING_CONFIG: PartnerConfig = {
  SHOPIFY_PARTNER_ORG_ID: "0",
  SHOPIFY_PARTNER_APP_ID: "0",
  SHOPIFY_PARTNER_API_TOKEN: Redacted.make("planning"),
};

/**
 * The shop's app subscription as the Partner API reports it: every item's handle, the plan's and
 * the meters' alike, and its billing cycle. Which handle is the plan is the catalog's question,
 * so the allowlist lives in one place, the plan check.
 */
export interface PartnerSubscription {
  /** Each item's handle, in Shopify's order; an item without one is left out. */
  readonly handles: readonly string[];
  /**
   * The next instant the subscription may change unannounced: `currentBillingCycle.endTime`,
   * or `trialEndsAt` during a trial, when there is no cycle. Null when neither reads.
   */
  readonly boundaryAt: DateTime.Utc | null;
  /** `currentBillingCycle.startTime`; null during a trial. */
  readonly cycleStartAt: DateTime.Utc | null;
}

export interface PartnerApiShape {
  /**
   * The shop's app subscription in force now (Shopify's `activeSubscription`). `None` is a
   * verified absence. A request that could not be answered, retries spent, is
   * `ShopifyUnavailableError`, never `None`: callers gate access on this, and "could not ask"
   * must never read as "has not paid". An answer that does not decode, carries GraphQL errors,
   * or a status that is not transient (a bad token) is a defect.
   */
  readonly activeSubscription: (
    shop: ShopDomain,
    shopGid: ShopGid,
  ) => Effect.Effect<Option.Option<PartnerSubscription>, ShopifyUnavailableError>;
  /** The shop's plan selection page on `admin.shopify.com`. */
  readonly planSelectionUrl: (shop: ShopDomain) => string;
}

const ACTIVE_SUBSCRIPTION_QUERY = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    items {
      handle
    }
    currentBillingCycle {
      startTime
      endTime
    }
    trialEndsAt
  }
}`;

/**
 * Every field past `items` is optional or nullable, so an answer that omits one still decodes:
 * losing a shop's access because Shopify stopped sending a bookkeeping field would be the worst
 * trade.
 */
const ActiveSubscriptionResponse = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      activeSubscription: Schema.NullOr(
        Schema.Struct({
          items: Schema.Array(Schema.Struct({ handle: Schema.NullOr(Schema.String) })),
          currentBillingCycle: Schema.optional(
            Schema.NullOr(
              Schema.Struct({
                startTime: Schema.optional(Schema.NullOr(Schema.String)),
                endTime: Schema.optional(Schema.NullOr(Schema.String)),
              }),
            ),
          ),
          trialEndsAt: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    }),
  ),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const decodeInstant = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString);

/** An ISO instant, or null when absent or unreadable. */
const instantOrNull = (value: string | null | undefined): DateTime.Utc | null =>
  Option.getOrNull(decodeInstant(value));

/** `PARTNER_RETRIES` transient retries, exponential from 500 ms, jittered: about 1.5 s. */
export const PARTNER_RETRIES = 2;

/**
 * How long one attempt waits for the Partner API's whole response, its headers and its body, the
 * same as a grant attempt's deadline (`GRANT_ATTEMPT_DEADLINE`): the merchant gate waits on this
 * call. An attempt past it is abandoned and counts as transient, so it is retried, and once the
 * retries are spent it is `ShopifyUnavailableError`. With the retries, a hung Partner API holds a
 * page about 16.5 s.
 */
export const PARTNER_ATTEMPT_DEADLINE = Duration.seconds(5);

/** What {@link PartnerApi.layer} takes: the app's handle and its Partner credentials. */
export interface PartnerApiOptions {
  /** The app's URL handle, which its plan selection page names. */
  readonly handle: string;
  readonly partner: PartnerConfig;
}

/** The shop's plan selection page for the app whose handle is `handle`. */
const planSelectionUrlOf = (handle: string) => (shop: ShopDomain) =>
  `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/u, "")}/charges/${handle}/pricing_plans`;

const make = Effect.fnUntraced(function* ({ handle, partner: config }: PartnerApiOptions) {
  const endpoint = `https://partners.shopify.com/${config.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`;
  // `activeSubscription` takes the Admin form; the Partner API's own `app(id:)` takes `gid://partners/App/…`.
  const appGid = `gid://shopify/App/${config.SHOPIFY_PARTNER_APP_ID}`;
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      Function.flow(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeader(
          "X-Shopify-Access-Token",
          Redacted.value(config.SHOPIFY_PARTNER_API_TOKEN),
        ),
      ),
    ),
    HttpClient.filterStatusOk,
    // Reads the body inside the attempt, so the deadline covers it too: a 200 whose body never
    // finishes would otherwise hold the gate past every deadline. The response caches it, so the
    // decode below reads it again for free.
    HttpClient.tap((response) => response.text),
    // Before the retries, so each attempt has its own deadline; a timed out attempt is a
    // transient `TransportError`, and the retries still honor a `Retry-After`.
    HttpClient.timeout(PARTNER_ATTEMPT_DEADLINE),
    HttpClient.retryTransient({
      schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
      times: PARTNER_RETRIES,
    }),
  );

  const activeSubscription = Effect.fn("PartnerApi.activeSubscription")(function* (
    shop: ShopDomain,
    shopGid: ShopGid,
  ) {
    yield* Effect.annotateCurrentSpan({ shop, shopGid });
    const { data, errors } = yield* HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        query: ACTIVE_SUBSCRIPTION_QUERY,
        variables: { appId: appGid, shopId: shopGid },
      }),
      client.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ActiveSubscriptionResponse)),
      Effect.catchTag("SchemaError", Effect.die),
      Effect.catchTag("HttpClientError", (error) =>
        HttpClient.isTransientError(error)
          ? unavailable("PartnerApi.activeSubscription", shop, error.reason._tag, {
              httpStatus: error.response?.status,
              cause: error,
            })
          : Effect.die(error),
      ),
    );
    // The query is fixed, so a GraphQL error means it, or the app's Partner configuration, is wrong.
    if (errors !== undefined && errors.length > 0)
      return yield* Effect.die(
        new Error(`Partner API errors: ${errors.map((each) => each.message).join("; ")}`),
      );
    // Only an explicit `activeSubscription: null` is a verified absence: an answer without `data`
    // would otherwise cache Unsubscribed for a paying merchant.
    if (data === undefined)
      return yield* Effect.die(new Error("Partner API answered with neither data nor errors"));
    const subscription = data.activeSubscription;
    if (subscription === null) return Option.none<PartnerSubscription>();
    return Option.some<PartnerSubscription>({
      handles: subscription.items.flatMap(({ handle }) =>
        handle === null || handle === "" ? [] : [handle],
      ),
      boundaryAt: instantOrNull(
        subscription.currentBillingCycle?.endTime ?? subscription.trialEndsAt,
      ),
      cycleStartAt: instantOrNull(subscription.currentBillingCycle?.startTime),
    });
  });

  return {
    activeSubscription,
    planSelectionUrl: planSelectionUrlOf(handle),
  } satisfies PartnerApiShape;
});

/**
 * {@link PartnerApi} over `config` and the `HttpClient` in context, which a test scripts. Not
 * exported from the package, so no transport type reaches an app.
 */
export const layerHttpClient = (options: PartnerApiOptions) =>
  Layer.effect(PartnerApi, make(options));

/** The Partner API. `/test`'s `PartnerFake` provides it in tests. */
export class PartnerApi extends Context.Service<PartnerApi, PartnerApiShape>()("app/PartnerApi") {
  /** Over `options`, with `fetch`. */
  static readonly layer = (options: PartnerApiOptions) =>
    layerHttpClient(options).pipe(Layer.provide(FetchHttpClient.layer));

  /**
   * Over `SHOPIFY_APP_HANDLE`, which the stack binds with the app, and `SHOPIFY_PARTNER_ORG_ID`,
   * `SHOPIFY_PARTNER_APP_ID` and `SHOPIFY_PARTNER_API_TOKEN`, which it binds when the stage has
   * them, with `fetch`. All are absent while the stack is planned, when nothing calls the Partner
   * API. A running Worker without the credentials gets {@link PartnerApi.layerUnbound}.
   */
  static readonly layerConfig = Layer.unwrap(
    Effect.gen(function* () {
      const handle = yield* Config.option(appHandleConfig).pipe(Effect.orDie);
      const partner = yield* Config.option(partnerConfig).pipe(Effect.orDie);
      if (Option.isSome(handle) && Option.isSome(partner))
        return PartnerApi.layer({ handle: handle.value, partner: partner.value });
      if (isAlchemyRuntime()) return PartnerApi.layerUnbound(handle);
      return PartnerApi.layer({ handle: PLANNING_HANDLE, partner: PLANNING_CONFIG });
    }),
  );

  /**
   * The Partner API of a running Worker the stack bound no Partner credentials to (a dev stage
   * before the owner adds them to `.env`): `activeSubscription` is a defect that says why, so a
   * plan is never guessed from a missing credential. The plan selection page needs only the
   * app's `handle`, which is public, so a shop whose plan is cached still passes the gate; it too
   * is a defect when the handle is unbound. The Backend still boots, so webhooks and the grantor
   * work.
   */
  static readonly layerUnbound = (handle: Option.Option<string>) =>
    Layer.succeed(
      PartnerApi,
      PartnerApi.of({
        activeSubscription: () =>
          Effect.die(new Error("the Partner API credentials are not bound")),
        planSelectionUrl: Option.match(handle, {
          onNone: () => () => {
            throw new Error("the Shopify app handle is not bound");
          },
          onSome: planSelectionUrlOf,
        }),
      }),
    );
}
