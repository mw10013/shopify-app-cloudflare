import { AuthenticateMerchantFailure, ShopifyAccessFailure } from "../internal/contract.mjs";
import { AppInstallation } from "../internal/app-installation.mjs";
import { ShopDomain, ShopGid } from "../internal/domain.mjs";
import { AdminToken } from "../internal/admin-token.mjs";
import { ShopifyHooksShape } from "../internal/hooks.mjs";
import { EnsureSessionFailure } from "../internal/shopify.mjs";
import { SubscriptionPlanShape } from "../internal/subscription-plan.mjs";
import { MerchantGateShape } from "../internal/merchant-gate.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
/**
 * A stored installation as a case seeds it: the grant columns, each unset one null. A schema,
 * so a test seeds a test Backend's database through `ShopifyTestDoor`.
 */
export declare const SeedInstallation: Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  readonly scope: Schema.optional<Schema.NullOr<Schema.String>>;
  readonly accessToken: Schema.optional<Schema.NullOr<Schema.String>>;
  readonly accessTokenExpiresAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
  readonly refreshToken: Schema.optional<Schema.NullOr<Schema.String>>;
  readonly refreshTokenExpiresAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
  /** The plan cache, as a revalidation wrote it; unset, the plan was never fetched. */
  readonly planHandle: Schema.optional<Schema.NullOr<Schema.String>>;
  readonly planHandleExpiresAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
  readonly planBoundaryAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
  /**
   * Whether the fake's ledger knows the seeded refresh token as one Shopify issued (by default
   * it does); `false` seeds the repair state, a token Shopify has retired.
   */
  readonly recognized: Schema.optional<Schema.Boolean>;
}>;
export type SeedInstallation = typeof SeedInstallation.Type;
/**
 * What a case needs that not every harness can give it. A harness in a test Backend runs the
 * case in the isolate the grantor Durable Object runs in, so a fake's intercept reaches the
 * object's grant, but neither the test clock nor the object's store does.
 */
export type HarnessCapability =
/** `TestClock` drives time, the grantor's included. */
"clock" |
/** The case gates a call mid-flight through the fake's intercept, or interrupts its caller. */
"interleave" |
/** The case holds the grantor's store write ({@link ShopifyHarnessShape.holdWrite}). */
"holdWrite";
/** A hold on the next grant write, from {@link ShopifyHarnessShape.holdWrite}. */
export interface HeldWrite {
  /** Succeeds once the held write has started. */
  readonly started: Effect.Effect<void>;
  /** Lets the held write through. */
  readonly release: Effect.Effect<void>;
}
/** A hook a case can break: its next call dies. */
export type HookName = keyof ShopifyHooksShape;
/** One line a harness logged: its level (`Info`, `Warn`, …) and message. */
export interface HarnessLogLine {
  readonly level: string;
  readonly message: string;
}
/** A webhook delivery a case sends, signed as Shopify signs one unless `signed` is false. */
export interface HarnessDelivery {
  readonly topic: string;
  readonly shop: ShopDomain;
  readonly payload: unknown;
  readonly signed?: boolean | undefined;
}
export interface ShopifyHarnessShape {
  readonly can: ReadonlySet<HarnessCapability>;
  /** Stores `row` as an exchange would, and by default tells the fake its refresh token. */
  readonly seed: (row: SeedInstallation) => Effect.Effect<void>;
  /** The stored row, tokens included: the invariant reads its refresh token. */
  readonly stored: (shop: ShopDomain) => Effect.Effect<Option.Option<AppInstallation>>;
  /** Ages the stored access token to expire now, as an hour passing would. */
  readonly expireAccessToken: (shop: ShopDomain) => Effect.Effect<void>;
  /** `app/uninstalled`'s grantor step: the epoch moves on and the row goes. */
  readonly uninstall: (shop: ShopDomain) => Effect.Effect<void>;
  /** The merchant path, through `MerchantGate.authenticateMerchant`: its shop and id. */
  readonly authenticateMerchant: (idToken: string) => Effect.Effect<{
    readonly shop: ShopDomain;
    readonly shopGid: ShopGid;
  }, AuthenticateMerchantFailure>;
  /** `MerchantGate`, every method. */
  readonly gate: MerchantGateShape;
  /** `SubscriptionPlan`. */
  readonly plans: SubscriptionPlanShape;
  /** POSTs a delivery to `Webhooks.serve`; answers its status. */
  readonly deliver: (delivery: HarnessDelivery) => Effect.Effect<number>;
  /** Every hook call since the harness was built, as `<hook>:<shop>`, oldest first. */
  readonly hookCalls: Effect.Effect<readonly string[]>;
  /** Makes `hook`'s next call die. */
  readonly breakHook: (hook: HookName) => Effect.Effect<void>;
  /** Every line logged since the harness was built, Debug included, oldest first. */
  readonly logs: Effect.Effect<readonly HarnessLogLine[]>;
  /** `Shopify.ensureSession`. */
  readonly ensureSession: (shop: ShopDomain) => Effect.Effect<AdminToken, EnsureSessionFailure>;
  /** `Shopify.adminGraphql`, its `data` decoded as `{ shop: { id } }`. */
  readonly adminGraphql: (shop: ShopDomain, query: string) => Effect.Effect<{
    readonly shop: {
      readonly id: string;
    };
  }, ShopifyAccessFailure>;
  /** With `holdWrite` only: holds the next grant write (`upsert` or `updateTokens`) until released. */
  readonly holdWrite: Effect.Effect<HeldWrite>;
}
declare const ShopifyHarness_base: Context.ServiceClass<ShopifyHarness, "app/ShopifyHarness", ShopifyHarnessShape>;
export declare class ShopifyHarness extends ShopifyHarness_base {}
export {};