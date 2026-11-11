import { assert, describe, it } from "@effect/vitest";
import {
  adminShopMethods,
  type AppInstallationRedacted,
  AppInstallations,
  PlanCatalog,
  ShopActors,
  ShopifyUnavailableError,
  SubscriptionPlan,
} from "@mw10013/shopify-app-cloudflare/backend";
import { Email } from "@mw10013/shopify-app-cloudflare/contract";
import { SiteAuthTest } from "@mw10013/shopify-app-cloudflare/test/node";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { at, SHOP, SHOP_GID, shopDomain } from "./fixtures.ts";

const ADMIN = Schema.decodeUnknownSync(Email)("admin@site.test");
const catalog = PlanCatalog.make({ "site-basic": {} });

const row = (plan: {
  readonly planHandle: string | null;
  readonly planHandleExpiresAt: DateTime.Utc | null;
}): AppInstallationRedacted => ({
  shop: SHOP,
  shopGid: SHOP_GID,
  scope: "read_products",
  accessTokenExpiresAt: null,
  hasAccessToken: true,
  planHandle: plan.planHandle,
  planHandleExpiresAt: plan.planHandleExpiresAt,
  planBoundaryAt: null,
  installedAt: at(0),
});

const services = (options: {
  readonly found?: AppInstallationRedacted;
  readonly refreshed?: string[];
  readonly unavailable?: boolean;
}) =>
  Layer.mergeAll(
    Layer.mock(AppInstallations)({
      find: () => Effect.succeed(Option.fromUndefinedOr(options.found)),
    }),
    Layer.mock(SubscriptionPlan)({
      refresh: (shop) =>
        options.unavailable === true
          ? Effect.fail(new ShopifyUnavailableError({ shop: SHOP }))
          : Effect.sync(() => {
              options.refreshed?.push(typeof shop === "string" ? shop : shop.shop);
              return { _tag: "Unsubscribed" } as const;
            }),
    }),
    ShopActors.layerTest(),
    SiteAuthTest.layer({ users: [{ email: ADMIN, role: "admin" }] }),
  );

const signedIn = Effect.map(SiteAuthTest.signIn(ADMIN), (cookie) => ({ cookie, ip: undefined }));

const cachedPlanOf = (found: AppInstallationRedacted) =>
  Effect.gen(function* () {
    const methods = yield* adminShopMethods(catalog);
    const data = yield* methods.adminShop(yield* signedIn, { shop: SHOP });
    return data._tag === "Found" ? data.plan : undefined;
  }).pipe(Effect.provide(services({ found })));

describe("adminShopMethods", () => {
  it.live("adminShop judges the cached plan at the read, through the catalog", () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const fresh = DateTime.addDuration(now, Duration.hours(1));
      const past = DateTime.subtractDuration(now, Duration.seconds(1));
      const cases = [
        [{ planHandle: null, planHandleExpiresAt: null }, { _tag: "NeverFetched" }],
        [{ planHandle: null, planHandleExpiresAt: fresh }, { _tag: "Unsubscribed" }],
        [
          { planHandle: "site-basic", planHandleExpiresAt: fresh },
          { _tag: "Subscribed", handle: "site-basic" },
        ],
        [
          { planHandle: "site-basic", planHandleExpiresAt: past },
          { _tag: "Stale", handle: "site-basic" },
        ],
        [
          { planHandle: "site-gone", planHandleExpiresAt: fresh },
          { _tag: "Unrecognized", handle: "site-gone" },
        ],
      ] as const;
      for (const [plan, expected] of cases)
        assert.deepStrictEqual(yield* cachedPlanOf(row(plan)), expected, JSON.stringify(plan));
    }),
  );

  it.live("adminShop answers NotFound for a shop with no row", () =>
    Effect.gen(function* () {
      const methods = yield* adminShopMethods(catalog);
      const request = yield* signedIn;
      assert.deepStrictEqual(
        yield* methods.adminShop(request, { shop: shopDomain("gone.myshopify.com") }),
        { _tag: "NotFound" },
      );
    }).pipe(Effect.provide(services({}))),
  );

  it.live("adminShop answers the encoded row, its cached plan and its actor id", () =>
    Effect.gen(function* () {
      const methods = yield* adminShopMethods(catalog);
      const data = yield* methods.adminShop(yield* signedIn, { shop: SHOP });
      assert.deepStrictEqual(data, {
        _tag: "Found",
        appInstallation: {
          shop: SHOP,
          shopGid: SHOP_GID,
          scope: "read_products",
          accessTokenExpiresAt: null,
          hasAccessToken: true,
          planHandle: null,
          planHandleExpiresAt: null,
          planBoundaryAt: null,
          installedAt: 0,
        },
        plan: { _tag: "NeverFetched" },
        shopActorId: `id:${SHOP}`,
      });
    }).pipe(
      Effect.provide(services({ found: row({ planHandle: null, planHandleExpiresAt: null }) })),
    ),
  );

  it.live("refreshPlan re-reads the shop's plan", () => {
    const refreshed: string[] = [];
    return Effect.gen(function* () {
      const methods = yield* adminShopMethods(catalog);
      yield* methods.refreshPlan(yield* signedIn, { shop: SHOP });
      assert.deepStrictEqual(refreshed, [SHOP]);
    }).pipe(Effect.provide(services({ refreshed })));
  });

  it.live("refreshPlan with Shopify down crosses as its plain fields", () =>
    Effect.gen(function* () {
      const methods = yield* adminShopMethods(catalog);
      assert.deepStrictEqual(
        yield* Effect.flip(methods.refreshPlan(yield* signedIn, { shop: SHOP })),
        { _tag: "ShopifyUnavailableError", shop: SHOP },
      );
    }).pipe(Effect.provide(services({ unavailable: true }))),
  );

  it.live("refuses anyone signed out", () =>
    Effect.gen(function* () {
      const methods = yield* adminShopMethods(catalog);
      const signedOut = { cookie: undefined, ip: undefined };
      assert.deepStrictEqual(yield* Effect.flip(methods.refreshPlan(signedOut, { shop: SHOP })), {
        _tag: "UnauthorizedError",
      });
    }).pipe(Effect.provide(services({}))),
  );
});
