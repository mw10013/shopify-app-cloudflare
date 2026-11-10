/**
 * `PartnerFake`: the Partner API, scripted by shop GID.
 *
 * @module
 */

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PlanHandle, ShopDomain, ShopGid } from "#internal/domain.ts";
import { PartnerApi, type PartnerSubscription } from "#internal/partner-api.ts";
import { unavailable } from "#internal/shopify-client.ts";

import { FAKE_APP_HANDLE } from "./fake-app.ts";

/** The plan selection page under the fake, for a case to compare a refusal's `href` against. */
export const fakePlanSelectionUrl = (shop: ShopDomain) =>
  `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/u, "")}/charges/${FAKE_APP_HANDLE}/pricing_plans`;

/**
 * One scripted Partner answer for a shop: an app subscription whose items carry `handle` and
 * `otherHandles` (a usage meter's, say), in a billing cycle or, with a null `cycleStartAt`, a
 * trial; none; or a failure to answer, which is `ShopifyUnavailableError`. Data, so a test
 * process can send it to a test Backend in workerd.
 */
export const PartnerAnswer = Schema.Union([
  Schema.TaggedStruct("Subscribed", {
    handle: Schema.String,
    otherHandles: Schema.optional(Schema.Array(Schema.String)),
    cycleStartAt: Schema.NullOr(Schema.DateTimeUtcFromMillis),
    boundaryAt: Schema.NullOr(Schema.DateTimeUtcFromMillis),
  }),
  Schema.TaggedStruct("None", {}),
  Schema.TaggedStruct("Failure", { reason: Schema.String }),
]);
export type PartnerAnswer = typeof PartnerAnswer.Type;

/** The UTC month around `now`: the fake's default billing cycle. */
export const currentMonth = (now: DateTime.Utc) => {
  const start = DateTime.startOf(now, "month");
  return { start, end: DateTime.add(start, { months: 1 }) };
};

const make = (defaultHandle: PlanHandle) =>
  Effect.sync(() => {
    const answers = new Map<string, PartnerAnswer>();
    const asked: ShopGid[] = [];

    const activeSubscription = (shop: ShopDomain, shopGid: ShopGid) =>
      Effect.gen(function* () {
        asked.push(shopGid);
        const { start, end } = currentMonth(yield* DateTime.now);
        const scripted: PartnerAnswer = answers.get(shopGid) ?? {
          _tag: "Subscribed",
          handle: defaultHandle,
          cycleStartAt: start,
          boundaryAt: end,
        };
        return yield* Match.value(scripted).pipe(
          Match.tagsExhaustive({
            Subscribed: ({ handle, otherHandles, cycleStartAt, boundaryAt }) =>
              Effect.succeed(
                Option.some<PartnerSubscription>({
                  handles: [handle, ...(otherHandles ?? [])],
                  cycleStartAt,
                  boundaryAt,
                }),
              ),
            None: () => Effect.succeed(Option.none<PartnerSubscription>()),
            Failure: ({ reason }) => unavailable("PartnerApi.activeSubscription", shop, reason),
          }),
        );
      });

    return {
      /** Sets `shopGid`'s answer until the next script for it. */
      script: (shopGid: ShopGid, answer: PartnerAnswer) =>
        Effect.sync(() => {
          answers.set(shopGid, answer);
        }),
      /** Every shop GID asked about since the layer was built, oldest first. */
      asked: Effect.sync((): readonly ShopGid[] => [...asked]),
      /** Forgets every script and question, as a fresh fake would. */
      reset: Effect.sync(() => {
        answers.clear();
        asked.length = 0;
      }),
      service: PartnerApi.of({ activeSubscription, planSelectionUrl: fakePlanSelectionUrl }),
    };
  });

/**
 * The Partner API under test. Unscripted, every shop holds `defaultHandle` in the current UTC
 * month's billing cycle, so a test that is not about the plan passes every gate.
 */
export class PartnerFake extends Context.Service<
  PartnerFake,
  Effect.Success<ReturnType<typeof make>>
>()("app/PartnerFake") {
  /** The fake, and `PartnerApi` over it. */
  static readonly layer = (options: { readonly defaultHandle: PlanHandle }) =>
    Layer.effectContext(
      Effect.map(make(options.defaultHandle), (fake) =>
        Context.make(PartnerFake, fake).pipe(Context.add(PartnerApi, fake.service)),
      ),
    );
}
