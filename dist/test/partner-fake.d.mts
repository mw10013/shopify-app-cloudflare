import { PlanHandle, ShopDomain, ShopGid } from "../internal/domain.mjs";
import { PartnerApi, PartnerApiShape } from "../internal/partner-api.mjs";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
/** The plan selection page under the fake, for a case to compare a refusal's `href` against. */
export declare const fakePlanSelectionUrl: (shop: ShopDomain) => string;
/**
 * One scripted Partner answer for a shop: an app subscription whose items carry `handle` and
 * `otherHandles` (a usage meter's, say), in a billing cycle or, with a null `cycleStartAt`, a
 * trial; none; or a failure to answer, which is `ShopifyUnavailableError`. Data, so a test
 * process can send it to a test Backend in workerd.
 */
export declare const PartnerAnswer: Schema.Union<readonly [Schema.TaggedStruct<"Subscribed", {
  readonly handle: Schema.String;
  readonly otherHandles: Schema.optional<Schema.$Array<Schema.String>>;
  readonly cycleStartAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly boundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
}>, Schema.TaggedStruct<"None", {}>, Schema.TaggedStruct<"Failure", {
  readonly reason: Schema.String;
}>]>;
export type PartnerAnswer = typeof PartnerAnswer.Type;
/** The UTC month around `now`: the fake's default billing cycle. */
export declare const currentMonth: (now: DateTime.Utc) => {
  start: DateTime.Utc;
  end: DateTime.Utc;
};
declare const PartnerFake_base: Context.ServiceClass<PartnerFake, "app/PartnerFake", {
  /** Sets `shopGid`'s answer until the next script for it. */
  script: (shopGid: ShopGid, answer: PartnerAnswer) => Effect.Effect<void, never, never>;
  /** Every shop GID asked about since the layer was built, oldest first. */
  asked: Effect.Effect<readonly (string & import("effect/Brand").Brand<"ShopGid">)[], never, never>;
  /** Forgets every script and question, as a fresh fake would. */
  reset: Effect.Effect<void, never, never>;
  service: PartnerApiShape;
}>;
/**
 * The Partner API under test. Unscripted, every shop holds `defaultHandle` in the current UTC
 * month's billing cycle, so a test that is not about the plan passes every gate.
 */
export declare class PartnerFake extends PartnerFake_base {
  /** The fake, and `PartnerApi` over it. */
  static readonly layer: (options: {
    readonly defaultHandle: PlanHandle;
  }) => Layer.Layer<PartnerApi | PartnerFake, never, never>;
}
export {};