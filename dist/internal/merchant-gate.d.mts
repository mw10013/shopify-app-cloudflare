import { AppNotInstalledError, AuthenticateMerchantFailure, InvalidIdTokenError, MerchantAuthenticated, ShopifyUnavailableError } from "./contract.mjs";
import { PlanHandle, ShopDomain, ShopGid } from "./domain.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { PlanStatus } from "./catalog.mjs";
import { PartnerApi } from "./partner-api.mjs";
import { ShopifyClient } from "./shopify-client.mjs";
import { ShopifyMerchant } from "./shopify.mjs";
import { SubscriptionPlan } from "./subscription-plan.mjs";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
/** The socket gate's read: the shop, and its plan as data, so the gate picks a close code. */
export interface MerchantStanding {
  readonly shop: ShopDomain;
  readonly shopGid: ShopGid;
  readonly status: PlanStatus;
}
export interface MerchantGateShape {
  /**
   * The App Home guard: verify the ID token, exchange it when the stored token is not fresh,
   * then the plan from the row the merchant path read, so the row is read once. With
   * `billingRedirect` the plan is re-read from the Partner API. Unsubscribed:
   * `PlanUnsubscribedError { href }`.
   */
  readonly authenticateMerchant: (idToken: string, options?: {
    readonly billingRedirect?: boolean | undefined;
  }) => Effect.Effect<MerchantAuthenticated, AuthenticateMerchantFailure>;
  /**
   * A screen read: verify the ID token, read the row, resolve the plan from it. It never
   * exchanges, since a call per screen must not cost a grant. No row is a defect: the guard's
   * exchange wrote it. Unsubscribed: `PlanUnsubscribedError { href }`. Answers the row's
   * `installedAt` too, so a screen that shows it reads the row once.
   */
  readonly subscribedShop: (idToken: string) => Effect.Effect<{
    readonly shop: ShopDomain;
    readonly handle: PlanHandle;
    readonly installedAt: DateTime.Utc | null;
  }, AuthenticateMerchantFailure>;
  /**
   * The socket gate's read: the same verification and plan read with every outcome as data or a
   * typed failure the gate maps to a close code: no row is `AppNotInstalledError`, and an
   * unsubscribed shop is its `status`, with no href.
   */
  readonly merchantStanding: (idToken: string) => Effect.Effect<MerchantStanding, InvalidIdTokenError | AppNotInstalledError | ShopifyUnavailableError>;
  /**
   * The Manage plan press: verify the ID token, then `SubscriptionPlan.expectChange`, which
   * shortens the cache deadline and runs the app's `beforePlanChange`. A write that grants
   * nothing, so a lapsed shop is not refused.
   */
  readonly expectPlanChange: (idToken: string) => Effect.Effect<void, InvalidIdTokenError>;
}
declare const MerchantGate_base: Context.ServiceClass<MerchantGate, "app/MerchantGate", MerchantGateShape>;
/** The merchant gate, over tier 1's merchant path, the store, the plan check and the Partner API. */
export declare class MerchantGate extends MerchantGate_base {
  static readonly layer: Layer.Layer<MerchantGate, never, AppInstallationStore | PartnerApi | ShopifyClient | ShopifyMerchant | SubscriptionPlan>;
}
export {};