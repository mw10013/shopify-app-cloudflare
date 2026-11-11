/**
 * The Backend half of the common admin pages: the Shops list, the shop page and Refresh plan, as
 * the admin's Backend binding methods.
 *
 * @module
 */

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  AdminShopData,
  AdminShopRequest,
  APP_INSTALLATIONS_PAGE_SIZE,
  AppInstallationsPageRequest,
  type CachedPlan,
} from "./admin-contract.ts";
import { AppInstallationRedactedPage } from "./app-installation.ts";
import type { PlanCatalog } from "./catalog.ts";
import { ShopifyUnavailableError } from "./contract.ts";
import { ShopActors } from "./shop-actors.ts";
import { AppInstallations } from "./shopify-access.ts";
import { serveAdmin } from "./site-admin.ts";
import { type PlanCacheRow, SubscriptionPlan } from "./subscription-plan.ts";

/** The row's cached plan at `now`, read through `catalog` as the merchant path reads it. */
const cachedPlan = (
  { planHandle, planHandleExpiresAt }: Pick<PlanCacheRow, "planHandle" | "planHandleExpiresAt">,
  now: DateTime.Utc,
  catalog: PlanCatalog,
): CachedPlan => {
  if (planHandleExpiresAt === null)
    return planHandle === null ? { _tag: "NeverFetched" } : { _tag: "Stale", handle: planHandle };
  if (DateTime.isGreaterThanOrEqualTo(now, planHandleExpiresAt))
    return { _tag: "Stale", handle: planHandle };
  if (planHandle === null) return { _tag: "Unsubscribed" };
  return Option.match(catalog.parse(planHandle), {
    onNone: (): CachedPlan => ({ _tag: "Unrecognized", handle: planHandle }),
    onSome: (handle): CachedPlan => ({ _tag: "Subscribed", handle }),
  });
};

const decodeAppInstallationsPageRequest = Schema.decodeUnknownEffect(AppInstallationsPageRequest);
const decodeAdminShopRequest = Schema.decodeUnknownEffect(AdminShopRequest);
const encodeAppInstallationRedactedPage = Schema.encodeEffect(AppInstallationRedactedPage);
const encodeAdminShopData = Schema.encodeEffect(AdminShopData);

const failures = {
  appInstallationsPage: Schema.Never,
  adminShop: Schema.Never,
  refreshPlan: ShopifyUnavailableError,
};

/**
 * The common admin pages' methods over the app's `catalog`, each served through `serveAdmin`.
 * Viewing the shop page reads the cached plan and never resolves it, so looking at a shop does not
 * call Shopify or rewrite its row; `refreshPlan` is the deliberate re-read
 * (`SubscriptionPlan.refresh`). A payload that does not decode is a defect, as the Website's server
 * function already validated it.
 */
export const adminShopMethods = (catalog: PlanCatalog) =>
  Effect.gen(function* () {
    const installations = yield* AppInstallations;
    const plans = yield* SubscriptionPlan;
    const actors = yield* ShopActors;
    const methods = {
      appInstallationsPage: Effect.fn("Backend.appInstallationsPage")(function* (
        payload: AppInstallationsPageRequest,
      ) {
        const input = yield* decodeAppInstallationsPageRequest(payload).pipe(Effect.orDie);
        const page = yield* installations.page({ ...input, limit: APP_INSTALLATIONS_PAGE_SIZE });
        return yield* encodeAppInstallationRedactedPage(page).pipe(Effect.orDie);
      }),
      adminShop: Effect.fn("Backend.adminShop")(function* (payload: AdminShopRequest) {
        const { shop } = yield* decodeAdminShopRequest(payload).pipe(Effect.orDie);
        const appInstallation = yield* installations.find(shop);
        if (Option.isNone(appInstallation))
          return yield* encodeAdminShopData({ _tag: "NotFound" }).pipe(Effect.orDie);
        return yield* encodeAdminShopData({
          _tag: "Found",
          appInstallation: appInstallation.value,
          plan: cachedPlan(appInstallation.value, yield* DateTime.now, catalog),
          shopActorId: actors.idOf(shop),
        }).pipe(Effect.orDie);
      }),
      refreshPlan: Effect.fn("Backend.refreshPlan")(function* (payload: AdminShopRequest) {
        const { shop } = yield* decodeAdminShopRequest(payload).pipe(Effect.orDie);
        yield* plans.refresh(shop);
      }),
    };
    return yield* serveAdmin(methods, failures);
  });
