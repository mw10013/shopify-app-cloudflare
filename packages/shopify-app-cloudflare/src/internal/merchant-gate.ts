/**
 * `MerchantGate`: the one way to a merchant. Every caller that holds an ID token, the App Home
 * guard, a screen read, the socket gate and the Manage plan press, goes through it, so none
 * re-derives the token check or the plan check.
 *
 * @module
 */

import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AppInstallationStore } from "./app-installation-store.ts";
import type { PlanStatus } from "./catalog.ts";
import {
  AppNotInstalledError,
  type AuthenticateMerchantFailure,
  type InvalidIdTokenError,
  type MerchantAuthenticated,
  PlanUnsubscribedError,
  type ShopifyUnavailableError,
} from "./contract.ts";
import type { PlanHandle, ShopDomain, ShopGid } from "./domain.ts";
import { PartnerApi } from "./partner-api.ts";
import { ShopifyClient, unavailable } from "./shopify-client.ts";
import { ShopifyMerchant } from "./shopify.ts";
import { SubscriptionPlan } from "./subscription-plan.ts";

/**
 * Where an unsubscribed merchant goes, as an `/app`-relative href: the plan selection page, which
 * `admin.shopify.com` serves and so cannot render in the app's frame; `/auth/exit-iframe` breaks
 * out of it first.
 */
export const planSelectionHref = (planSelectionUrl: string, shop: ShopDomain) =>
  `/auth/exit-iframe?exitIframe=${encodeURIComponent(planSelectionUrl)}&shop=${shop}`;

/** The socket gate's read: the shop, and its plan as data, so the gate picks a close code. */
export interface MerchantStanding {
  readonly shop: ShopDomain;
  readonly shopGid: ShopGid;
  readonly status: PlanStatus;
}

export interface MerchantGateShape {
  /**
   * The App Home guard: verify the ID token, mint when the stored token is not fresh, then the
   * plan from the row the merchant path read, so the row is read once. With
   * `billingRedirect` the plan is re-read from the Partner API. Unsubscribed:
   * `PlanUnsubscribedError { href }`.
   */
  readonly authenticateMerchant: (
    idToken: string,
    options?: { readonly billingRedirect?: boolean | undefined },
  ) => Effect.Effect<MerchantAuthenticated, AuthenticateMerchantFailure>;
  /**
   * A screen read: verify the ID token, read the row, resolve the plan from it. It never mints,
   * since a call per screen must not cost a Shopify request. No row is a defect: the guard's
   * mint wrote it. Unsubscribed: `PlanUnsubscribedError { href }`. Answers the row's
   * `installedAt` too, so a screen that shows it reads the row once.
   */
  readonly subscribedShop: (idToken: string) => Effect.Effect<
    {
      readonly shop: ShopDomain;
      readonly handle: PlanHandle;
      readonly installedAt: DateTime.Utc | null;
    },
    AuthenticateMerchantFailure
  >;
  /**
   * The ID token's verified shop, with no read: a socket gate refuses a token for another shop
   * before {@link merchantStanding} reads that shop's row or plan.
   */
  readonly verifiedShop: (idToken: string) => Effect.Effect<ShopDomain, InvalidIdTokenError>;
  /**
   * The socket gate's read: the same verification and plan read with every outcome as data or a
   * typed failure the gate maps to a close code: no row is `AppNotInstalledError`, and an
   * unsubscribed shop is its `status`, with no href.
   */
  readonly merchantStanding: (
    idToken: string,
  ) => Effect.Effect<
    MerchantStanding,
    InvalidIdTokenError | AppNotInstalledError | ShopifyUnavailableError
  >;
  /**
   * The Manage plan press: verify the ID token, then `SubscriptionPlan.expectChange`, which
   * shortens the cache deadline and runs the app's `beforePlanChange`. A write that grants
   * nothing, so a lapsed shop is not refused.
   */
  readonly expectPlanChange: (idToken: string) => Effect.Effect<void, InvalidIdTokenError>;
}

const make = Effect.gen(function* () {
  const client = yield* ShopifyClient;
  const merchant = yield* ShopifyMerchant;
  const installations = yield* AppInstallationStore;
  const plans = yield* SubscriptionPlan;
  const partner = yield* PartnerApi;

  const unsubscribed = (shop: ShopDomain) =>
    new PlanUnsubscribedError({ href: planSelectionHref(partner.planSelectionUrl(shop), shop) });

  const authenticateMerchant = Effect.fn("MerchantGate.authenticateMerchant")(function* (
    idToken: string,
    options: { readonly billingRedirect?: boolean | undefined } = {},
  ) {
    const { shop, shopGid, stored } = yield* merchant.authenticateMerchant(idToken);
    // A first install read no row before its mint, so the plan check reads the new one. None
    // means an uninstall deleted it since: nothing the merchant can act on, so it reads as an
    // outage.
    const row = Option.isSome(stored) ? stored : yield* installations.find(shop);
    if (Option.isNone(row))
      return yield* unavailable("MerchantGate.authenticateMerchant", shop, "uninstalled");
    const status = yield* options.billingRedirect === true
      ? plans.refresh(row.value)
      : plans.resolve(row.value);
    if (status._tag === "Unsubscribed") return yield* unsubscribed(shop);
    return {
      shop,
      shopGid,
      managePlanUrl: partner.planSelectionUrl(shop),
    } satisfies MerchantAuthenticated;
  });

  /** The verified shop's row, never minted; no row is `AppNotInstalledError`. */
  const installedRow = Effect.fnUntraced(function* (idToken: string) {
    const { shop } = yield* client.decodeIdToken(idToken);
    const row = yield* installations.find(shop);
    if (Option.isNone(row)) return yield* new AppNotInstalledError({ shop });
    return row.value;
  });

  const subscribedShop = Effect.fn("MerchantGate.subscribedShop")(function* (idToken: string) {
    const row = yield* installedRow(idToken).pipe(
      Effect.catchTag("AppNotInstalledError", Effect.die),
    );
    const status = yield* plans.resolve(row);
    if (status._tag === "Unsubscribed") return yield* unsubscribed(row.shop);
    return { shop: row.shop, handle: status.handle, installedAt: row.installedAt };
  });

  const verifiedShop = Effect.fn("MerchantGate.verifiedShop")(function* (idToken: string) {
    return (yield* client.decodeIdToken(idToken)).shop;
  });

  const merchantStanding = Effect.fn("MerchantGate.merchantStanding")(function* (idToken: string) {
    const row = yield* installedRow(idToken);
    return {
      shop: row.shop,
      shopGid: row.shopGid,
      status: yield* plans.resolve(row),
    } satisfies MerchantStanding;
  });

  const expectPlanChange = Effect.fn("MerchantGate.expectPlanChange")(function* (idToken: string) {
    const { shop } = yield* client.decodeIdToken(idToken);
    yield* plans.expectChange(shop);
  });

  return {
    authenticateMerchant,
    subscribedShop,
    verifiedShop,
    merchantStanding,
    expectPlanChange,
  } satisfies MerchantGateShape;
});

/** The merchant gate, over tier 1's merchant path, the store, the plan check and the Partner API. */
export class MerchantGate extends Context.Service<MerchantGate, MerchantGateShape>()(
  "app/MerchantGate",
) {
  static readonly layer = Layer.effect(MerchantGate, make);
}
