import { PartnerFake } from "./partner-fake.mjs";
import { ShopifyFake } from "./shopify-fake.mjs";
import { HarnessCapability, ShopifyHarness } from "./shopify-harness.mjs";
import "effect/DateTime";
import "effect/Option";
import * as Effect from "effect/Effect";
/** One required behavior: a spec case by number, or a package case (`N…`). */
export interface RequiredBehavior {
  readonly id: string;
  readonly name: string;
  /** What the harness must be able to do; a harness without it skips the case. */
  readonly needs: readonly HarnessCapability[];
  /** The case's budget in milliseconds, when retries or a deadline make it slow. */
  readonly timeout?: number;
  readonly run: Effect.Effect<void, unknown, ShopifyHarness | ShopifyFake | PartnerFake>;
}
/** The shop every case runs against. */
export declare const BEHAVIOR_SHOP: string & import("effect/Brand").Brand<"ShopDomain">;
/** The seeded shop's id; a first install fetches `FAKE_SHOP_GID` instead. */
export declare const BEHAVIOR_SHOP_GID: string & import("effect/Brand").Brand<"ShopGid">;
/**
 * Every authentication case: `ensureSession` (9–14, 17, 18, 20–24, 26, 27, 49), the merchant
 * path through the merchant gate (28, 29, 31–38, 50), abandoned grant attempts (51) and
 * `adminGraphql` (39–45). Webhooks (46–48) are in `APP_BEHAVIORS`.
 */
export declare const AUTH_BEHAVIORS: readonly RequiredBehavior[];