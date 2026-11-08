/**
 * `PartnerApi`: the Partner API, billing's one external seam. One query, the shop's app
 * subscription, and the plan selection page's URL.
 *
 * @module
 */

import * as Config from "effect/Config";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
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

import type { ShopifyUnavailableError } from "./contract.ts";
import type { ShopDomain, ShopGid } from "./domain.ts";
import { isAlchemyRuntime, unavailable } from "./shopify-client.ts";
import { PARTNER_API_VERSION } from "./versions.ts";

/**
 * A Shopify app's URL handle: the `<handle>` of its pricing page,
 * `admin.shopify.com/store/<store>/charges/<handle>/pricing_plans`. Lowercase letters, digits
 * and dashes.
 */
const AppHandle = Schema.NonEmptyString.check(Schema.isPattern(/^[a-z0-9-]+$/u));

/** A Partner Dashboard id (an organization's or an app's): the digits in its URL. */
const PartnerId = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9]+$/u));

/**
 * What the app's Partner organization issues for one stage, beyond the app's key and secret: its
 * handle, the organization and app ids, and a Partner API token with **Manage apps**. The stack
 * binds them to the Backend under these names.
 */
export const PartnerConfig = Schema.Struct({
  SHOPIFY_APP_HANDLE: AppHandle,
  SHOPIFY_PARTNER_ORG_ID: PartnerId,
  SHOPIFY_PARTNER_APP_ID: PartnerId,
  SHOPIFY_PARTNER_API_TOKEN: Schema.Redacted(Schema.NonEmptyString),
});
export type PartnerConfig = typeof PartnerConfig.Type;

/**
 * {@link PartnerConfig} read one key at a time, then decoded: a `Config.schema` of the whole
 * struct finds nothing among a Worker's bindings, which answer one name at a time (measured in
 * baton under `alchemy dev`).
 */
const partnerConfig: Config.Config<PartnerConfig> = Config.all({
  SHOPIFY_APP_HANDLE: Config.String("SHOPIFY_APP_HANDLE"),
  SHOPIFY_PARTNER_ORG_ID: Config.String("SHOPIFY_PARTNER_ORG_ID"),
  SHOPIFY_PARTNER_APP_ID: Config.String("SHOPIFY_PARTNER_APP_ID"),
  SHOPIFY_PARTNER_API_TOKEN: Config.Redacted("SHOPIFY_PARTNER_API_TOKEN"),
}).pipe(
  Config.mapEffect((values) =>
    Schema.decodeUnknownEffect(PartnerConfig)(values).pipe(
      Effect.mapError((issue) => new Config.ConfigError(issue)),
    ),
  ),
);

/** Stand-ins while the stack is planned, when nothing calls the Partner API; they only decode. */
const PLANNING_CONFIG: PartnerConfig = {
  SHOPIFY_APP_HANDLE: "planning",
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

const make = Effect.fnUntraced(function* (config: PartnerConfig) {
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
    const subscription = data?.activeSubscription;
    if (subscription === undefined || subscription === null)
      return Option.none<PartnerSubscription>();
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

  const planSelectionUrl = (shop: ShopDomain) =>
    `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/u, "")}/charges/${config.SHOPIFY_APP_HANDLE}/pricing_plans`;

  return { activeSubscription, planSelectionUrl } satisfies PartnerApiShape;
});

/**
 * {@link PartnerApi} over `config` and the `HttpClient` in context, which a test scripts. Not
 * exported from the package, so no transport type reaches an app.
 */
export const layerHttpClient = (config: PartnerConfig) => Layer.effect(PartnerApi, make(config));

/** The Partner API. `/test`'s `PartnerFake` provides it in tests. */
export class PartnerApi extends Context.Service<PartnerApi, PartnerApiShape>()("app/PartnerApi") {
  /** Over `config`, with `fetch`. */
  static readonly layer = (config: PartnerConfig) =>
    layerHttpClient(config).pipe(Layer.provide(FetchHttpClient.layer));

  /**
   * Over `SHOPIFY_APP_HANDLE`, `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_APP_ID` and
   * `SHOPIFY_PARTNER_API_TOKEN`, which the stack binds to the Backend, with `fetch`. They are
   * absent while the stack is planned, when nothing calls the Partner API; a running Worker
   * without them is broken.
   */
  static readonly layerConfig = Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* Config.option(partnerConfig).pipe(Effect.orDie);
      if (Option.isSome(config)) return PartnerApi.layer(config.value);
      if (isAlchemyRuntime())
        return yield* Effect.die(new Error("the Partner API credentials are not bound"));
      return PartnerApi.layer(PLANNING_CONFIG);
    }),
  );
}
