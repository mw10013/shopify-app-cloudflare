/**
 * `ShopifyHarness`: what a required-behavior case drives. One interface, so the same cases run
 * in process (`/test/node`'s `inProcessHarness`) and, later, against a test Backend in workerd.
 *
 * @module
 */

import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { AdminToken } from "#internal/admin-token.ts";
import type { AppInstallation } from "#internal/app-installation-store.ts";
import type {
  InvalidIdTokenError,
  ShopifyAccessFailure,
  ShopifyUnavailableError,
} from "#internal/contract.ts";
import type { ShopDomain, ShopGid } from "#internal/domain.ts";
import type { EnsureSessionFailure } from "#internal/shopify.ts";

/** A stored installation as a case seeds it: the grant columns, each unset one null. */
export interface SeedInstallation {
  readonly shop: ShopDomain;
  readonly shopGid: ShopGid;
  readonly scope?: string | null | undefined;
  readonly accessToken?: string | null | undefined;
  readonly accessTokenExpiresAt?: DateTime.Utc | null | undefined;
  readonly refreshToken?: string | null | undefined;
  readonly refreshTokenExpiresAt?: DateTime.Utc | null | undefined;
  /**
   * Whether the fake's ledger knows the seeded refresh token as one Shopify issued (by default
   * it does); `false` seeds the repair state, a token Shopify has retired.
   */
  readonly recognized?: boolean | undefined;
}

/** What a case needs that only an in-process harness can give it. */
export type HarnessCapability =
  /** `TestClock` drives time. */
  | "clock"
  /** The case gates a call mid-flight: an intercept, a held write, an interrupted caller. */
  | "interleave";

/** A hold on the next grant write, from {@link ShopifyHarnessShape.holdWrite}. */
export interface HeldWrite {
  /** Succeeds once the held write has started. */
  readonly started: Effect.Effect<void>;
  /** Lets the held write through. */
  readonly release: Effect.Effect<void>;
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
  /** The merchant path. */
  readonly authenticateMerchant: (
    idToken: string,
  ) => Effect.Effect<
    { readonly shop: ShopDomain; readonly shopGid: ShopGid },
    InvalidIdTokenError | ShopifyUnavailableError
  >;
  /** `Shopify.ensureSession`. */
  readonly ensureSession: (shop: ShopDomain) => Effect.Effect<AdminToken, EnsureSessionFailure>;
  /** `Shopify.adminGraphql`, its `data` decoded as `{ shop: { id } }`. */
  readonly adminGraphql: (
    shop: ShopDomain,
    query: string,
  ) => Effect.Effect<{ readonly shop: { readonly id: string } }, ShopifyAccessFailure>;
  /** In-process only: holds the next grant write (`upsert` or `updateTokens`) until released. */
  readonly holdWrite: Effect.Effect<HeldWrite>;
}

export class ShopifyHarness extends Context.Service<ShopifyHarness, ShopifyHarnessShape>()(
  "app/ShopifyHarness",
) {}
