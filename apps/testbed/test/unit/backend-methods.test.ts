import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { ShopDomain, ShopGid } from "@mw10013/shopify-app-cloudflare/backend";
import {
  fakePlanSelectionUrl,
  mintIdToken,
  PartnerFake,
} from "@mw10013/shopify-app-cloudflare/test";
import { ShopifyAppTest } from "@mw10013/shopify-app-cloudflare/test/node";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { testbedApp } from "#backend/app.ts";
import { backendMethods } from "#backend/methods.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));
const SHOP = Schema.decodeUnknownSync(ShopDomain)("methods-shop.myshopify.com");
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/8");

/** What crossed the binding: the failure as the Website would receive it. */
const crossed = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    assert.isTrue(Exit.isFailure(exit));
    return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  });

const testbed = () =>
  ShopifyAppTest.layer({
    app: testbedApp,
    migrationsDir,
    seed: [{ shop: SHOP, shopGid: SHOP_GID, scope: "" }],
  });

describe("Backend.authenticateMerchant over the binding", () => {
  it.effect("answers a subscribed merchant with its shop and the Manage plan page", () =>
    Effect.gen(function* () {
      const methods = yield* backendMethods;
      const answer = yield* methods.authenticateMerchant({
        idToken: yield* mintIdToken({ shop: SHOP }),
      });
      assert.deepStrictEqual(answer, {
        shop: SHOP,
        shopGid: SHOP_GID,
        managePlanUrl: fakePlanSelectionUrl(SHOP),
      });
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("an unsubscribed merchant crosses as PlanUnsubscribedError's plain fields", () =>
    Effect.gen(function* () {
      const partner = yield* PartnerFake;
      yield* partner.script(SHOP_GID, { _tag: "None" });
      const methods = yield* backendMethods;
      const failure = yield* crossed(
        methods.authenticateMerchant({
          idToken: yield* mintIdToken({ shop: SHOP }),
          billingRedirect: true,
        }),
      );
      assert.notInstanceOf(failure, Error);
      assert.strictEqual((failure as { readonly _tag: string })._tag, "PlanUnsubscribedError");
      assert.include((failure as { readonly href: string }).href, "/auth/exit-iframe");
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("a token that does not verify crosses as InvalidIdTokenError", () =>
    Effect.gen(function* () {
      const methods = yield* backendMethods;
      assert.deepStrictEqual(yield* crossed(methods.authenticateMerchant({ idToken: "nope" })), {
        _tag: "InvalidIdTokenError",
      });
    }).pipe(Effect.provide(testbed())),
  );
});

describe("Backend.appHome over the binding", () => {
  it.effect("answers the shop, the plan's handle and when the row was inserted", () =>
    Effect.gen(function* () {
      const methods = yield* backendMethods;
      const answer = yield* methods.appHome({ idToken: yield* mintIdToken({ shop: SHOP }) });
      // The seed's insert ran at the test clock's start.
      assert.deepStrictEqual(answer, {
        shop: SHOP,
        planHandle: "testbed-basic",
        installedAt: DateTime.formatIso(DateTime.makeUnsafe(0)),
      });
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("names the plan the Partner API holds, testbed-pro included", () =>
    Effect.gen(function* () {
      const partner = yield* PartnerFake;
      yield* partner.script(SHOP_GID, {
        _tag: "Subscribed",
        handle: "testbed-pro",
        cycleStartAt: null,
        boundaryAt: null,
      });
      const methods = yield* backendMethods;
      const answer = yield* methods.appHome({ idToken: yield* mintIdToken({ shop: SHOP }) });
      assert.strictEqual(answer.planHandle, "testbed-pro");
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("an unsubscribed merchant crosses as PlanUnsubscribedError", () =>
    Effect.gen(function* () {
      const partner = yield* PartnerFake;
      yield* partner.script(SHOP_GID, { _tag: "None" });
      const methods = yield* backendMethods;
      const failure = yield* crossed(
        methods.appHome({ idToken: yield* mintIdToken({ shop: SHOP }) }),
      );
      assert.strictEqual((failure as { readonly _tag: string })._tag, "PlanUnsubscribedError");
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("a token that does not verify crosses as InvalidIdTokenError", () =>
    Effect.gen(function* () {
      const methods = yield* backendMethods;
      assert.deepStrictEqual(yield* crossed(methods.appHome({ idToken: "nope" })), {
        _tag: "InvalidIdTokenError",
      });
    }).pipe(Effect.provide(testbed())),
  );
});
