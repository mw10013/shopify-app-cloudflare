import { assert, describe, it } from "@effect/vitest";
import { MerchantGate, PlanCatalog, ShopifyApp } from "@mw10013/shopify-app-cloudflare/backend";
import { mintIdToken, PartnerFake } from "@mw10013/shopify-app-cloudflare/test";
import { D1Test, ShopifyAppTest } from "@mw10013/shopify-app-cloudflare/test/node";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { SHOP, SHOP_GID } from "./fixtures.ts";

const app = ShopifyApp.define({ catalog: PlanCatalog.make({ "test-basic": {} }) });

describe("ShopifyAppTest.layer", () => {
  it.effect("serves the gate over the fakes for a seeded shop, the fake's default plan first", () =>
    Effect.gen(function* () {
      const gate = yield* MerchantGate;
      const answer = yield* gate.authenticateMerchant(yield* mintIdToken({ shop: SHOP }));
      assert.strictEqual(answer.shop, SHOP);
      assert.strictEqual(answer.shopGid, SHOP_GID);
    }).pipe(
      Effect.provide(
        ShopifyAppTest.layer({ app, seed: [{ shop: SHOP, shopGid: SHOP_GID, scope: "" }] }),
      ),
    ),
  );

  it.effect("a lapsed shop is refused, and the app's hooks run", () => {
    const calls: string[] = [];
    return Effect.gen(function* () {
      const partner = yield* PartnerFake;
      yield* partner.script(SHOP_GID, { _tag: "None" });
      const gate = yield* MerchantGate;
      const exit = yield* Effect.exit(
        gate.authenticateMerchant(yield* mintIdToken({ shop: SHOP }), { billingRedirect: true }),
      );
      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(calls, [`afterPlanRevalidated:${SHOP}`]);
      const { sqlite } = yield* D1Test;
      assert.deepStrictEqual(sqlite.prepare("select shop from AppInstallation").all(), [
        { shop: SHOP },
      ]);
    }).pipe(
      Effect.provide(
        ShopifyAppTest.layer({
          app,
          seed: [{ shop: SHOP, shopGid: SHOP_GID, scope: "" }],
          hooks: {
            afterPlanRevalidated: ({ shop }) =>
              Effect.sync(() => {
                calls.push(`afterPlanRevalidated:${shop}`);
              }),
          },
        }),
      ),
    );
  });
});
