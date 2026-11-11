import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AppInstallationStore } from "#internal/app-installation-store.ts";
import { PlanCatalog } from "#internal/catalog.ts";
import { ShopifyHooks } from "#internal/hooks.ts";
import { MerchantGate } from "#internal/merchant-gate.ts";
import { PartnerApi } from "#internal/partner-api.ts";
import { ShopifyAccess } from "#internal/shopify-access.ts";
import { ShopifyApp } from "#internal/shopify-app.ts";
import { FAKE_APP_HANDLE } from "#test/fake-app.ts";
import { seedInstallation } from "#test/harness-support.ts";
import { mintIdToken } from "#test/id-token.ts";
import { d1Store, fakeAppClients } from "#test/node/shopify-app-test.ts";
import { ShopifyFake } from "#test/shopify-fake.ts";

import { SHOP, SHOP_GID } from "./fixtures.ts";

const app = ShopifyApp.define({ catalog: PlanCatalog.make({ "test-basic": {} }) });

/** Both tiers as a Backend without Partner credentials builds them: `PartnerApi.layerUnbound`. */
const unboundPartnerTiers = ShopifyApp.layerNoDeps(app).pipe(
  Layer.provideMerge(ShopifyHooks.layerNoop),
  Layer.provideMerge(PartnerApi.layerUnbound(Option.some(FAKE_APP_HANDLE))),
  Layer.provideMerge(ShopifyAccess.layerNoDeps),
  Layer.provideMerge(fakeAppClients),
  Layer.provideMerge(d1Store({})),
  Layer.provideMerge(ShopifyFake.layer),
);

/** Seeds the shop with a fresh token and a plan cache that expires `planIn` from now. */
const seedShop = (planIn: Duration.Input) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    yield* Effect.scoped(
      seedInstallation(yield* AppInstallationStore, yield* ShopifyFake, {
        shop: SHOP,
        shopGid: SHOP_GID,
        scope: "",
        accessToken: "shpat_fresh",
        accessTokenExpiresAt: DateTime.addDuration(now, "1 hour"),
        planHandle: "test-basic",
        planHandleExpiresAt: DateTime.addDuration(now, planIn),
      }),
    );
  });

describe("MerchantGate.authenticateMerchant without Partner credentials", () => {
  it.effect("a shop whose cached plan is fresh and subscribed passes, never asking Partner", () =>
    Effect.gen(function* () {
      yield* seedShop("1 day");
      const gate = yield* MerchantGate;
      const answer = yield* gate.authenticateMerchant(yield* mintIdToken({ shop: SHOP }));
      assert.strictEqual(answer.shop, SHOP);
      assert.strictEqual(
        answer.managePlanUrl,
        `https://admin.shopify.com/store/seed-shop/charges/${FAKE_APP_HANDLE}/pricing_plans`,
      );
    }).pipe(Effect.provide(unboundPartnerTiers)),
  );

  it.effect("a shop whose plan must be read dies, naming the missing credentials", () =>
    Effect.gen(function* () {
      yield* seedShop("1 day");
      const gate = yield* MerchantGate;
      const exit = yield* Effect.exit(
        gate.authenticateMerchant(yield* mintIdToken({ shop: SHOP }), { billingRedirect: true }),
      );
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      if (Exit.isFailure(exit))
        assert.match(String(Cause.squash(exit.cause)), /Partner API credentials are not bound/u);
    }).pipe(Effect.provide(unboundPartnerTiers)),
  );
});
