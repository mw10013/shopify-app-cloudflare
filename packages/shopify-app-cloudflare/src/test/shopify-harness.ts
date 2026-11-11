/**
 * `ShopifyHarness`: what a required-behavior case drives. One interface, so the same cases run
 * in process (`/test/node`'s `inProcessHarness`) and inside a test Backend in workerd
 * (`ShopifyTestDoor`).
 *
 * @module
 */

import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { AdminToken } from "#internal/admin-token.ts";
import type { AppInstallation } from "#internal/app-installation.ts";
import type { AuthenticateMerchantFailure, ShopifyAccessFailure } from "#internal/contract.ts";
import { ShopDomain, ShopGid } from "#internal/domain.ts";
import type { ShopifyHooksShape } from "#internal/hooks.ts";
import type { MerchantGateShape } from "#internal/merchant-gate.ts";
import type { EnsureSessionFailure } from "#internal/shopify.ts";
import type { SubscriptionPlanShape } from "#internal/subscription-plan.ts";

const Instant = Schema.optional(Schema.NullOr(Schema.DateTimeUtcFromMillis));

/**
 * A stored installation as a case seeds it, each unset column null. A schema, so a test seeds a
 * test Backend's database through `ShopifyTestDoor`.
 */
export const SeedInstallation = Schema.Struct({
  shop: ShopDomain,
  shopGid: ShopGid,
  scope: Schema.optional(Schema.NullOr(Schema.String)),
  accessToken: Schema.optional(Schema.NullOr(Schema.String)),
  accessTokenExpiresAt: Instant,
  /** A row from the refresh design: with `legacyRow` only. */
  refreshToken: Schema.optional(Schema.NullOr(Schema.String)),
  refreshTokenExpiresAt: Instant,
  /** The plan cache, as a revalidation wrote it; unset, the plan was never fetched. */
  planHandle: Schema.optional(Schema.NullOr(Schema.String)),
  planHandleExpiresAt: Instant,
  planBoundaryAt: Instant,
  /**
   * Whether Shopify has the app installed on the shop and issued the seeded access token (by
   * default it has); `false` seeds an orphaned row, one Shopify has uninstalled.
   */
  installed: Schema.optional(Schema.Boolean),
});
export type SeedInstallation = typeof SeedInstallation.Type;

/** What a case needs that not every harness can give it. */
export type HarnessCapability =
  /** `TestClock` drives time, the mint's and the fake's included. */
  | "clock"
  /** The case gates a call mid-flight through the fake's intercept. */
  | "interleave"
  /** The case seeds a row from the refresh design, written outside the store. */
  | "legacyRow";

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
  /**
   * Stores `row` as a mint would (inserted, or its token written over an existing row), and by
   * default installs the app on the shop at the fake and has it recognize the seeded token.
   */
  readonly seed: (row: SeedInstallation) => Effect.Effect<void>;
  /** The stored row, tokens included. */
  readonly stored: (shop: ShopDomain) => Effect.Effect<Option.Option<AppInstallation>>;
  /** Shopify uninstalls the app and `app/uninstalled`'s delete runs: no hooks. */
  readonly uninstall: (shop: ShopDomain) => Effect.Effect<void>;
  /** The merchant path, through `MerchantGate.authenticateMerchant`: its shop and id. */
  readonly authenticateMerchant: (
    idToken: string,
  ) => Effect.Effect<
    { readonly shop: ShopDomain; readonly shopGid: ShopGid },
    AuthenticateMerchantFailure
  >;
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
  readonly adminGraphql: (
    shop: ShopDomain,
    query: string,
  ) => Effect.Effect<{ readonly shop: { readonly id: string } }, ShopifyAccessFailure>;
}

export class ShopifyHarness extends Context.Service<ShopifyHarness, ShopifyHarnessShape>()(
  "app/ShopifyHarness",
) {}
