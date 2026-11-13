import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { assert } from "@effect/vitest";
import { ShopDomain, ShopGid } from "@mw10013/shopify-app-cloudflare/contract";
import {
  deliverWebhook,
  FAKE_SHOP_GID,
  fakePlanSelectionUrl,
  mintIdToken,
} from "@mw10013/shopify-app-cloudflare/test";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { catalog } from "#backend/app.ts";

import { call } from "./call.ts";
import { door } from "./door.ts";
import { fileStage } from "./file-stage.ts";
import Stack from "./stack.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: fileStage("backendbinding"),
});

const stack = beforeAll(deploy(Stack));
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack));

const SHOP = Schema.decodeUnknownSync(ShopDomain)("binding-shop.myshopify.com");
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/9");

const fresh = Effect.gen(function* () {
  const urls = yield* stack;
  yield* door(urls.backendUrl, (client) => client.Reset({}));
  return urls;
});

test(
  "authenticateMerchant over BACKEND: a first install mints against the fake and answers the shop",
  Effect.gen(function* () {
    const { backendUrl, websiteUrl } = yield* fresh;
    yield* door(backendUrl, (client) => client.InstallShopify({ shop: SHOP }));
    const outcome = yield* call(websiteUrl, "authenticateMerchant", {
      idToken: yield* mintIdToken({ shop: SHOP }),
    });
    assert.deepStrictEqual(outcome, {
      _tag: "Returned",
      value: { shop: SHOP, shopGid: FAKE_SHOP_GID, managePlanUrl: fakePlanSelectionUrl(SHOP) },
    });
  }),
);

test(
  "authenticateMerchant over BACKEND: an unsubscribed merchant's PlanUnsubscribedError arrives as its plain fields",
  Effect.gen(function* () {
    const { backendUrl, websiteUrl } = yield* fresh;
    yield* door(backendUrl, (client) =>
      client.ScriptPartner({ shopGid: SHOP_GID, answer: { _tag: "None" } }),
    );
    yield* door(backendUrl, (client) =>
      client.Seed({
        row: {
          shop: SHOP,
          shopGid: SHOP_GID,
          scope: "",
          accessToken: "shpat_seeded",
          accessTokenExpiresAt: DateTime.addDuration(DateTime.nowUnsafe(), Duration.hours(1)),
        },
      }),
    );
    const outcome = yield* call(websiteUrl, "authenticateMerchant", {
      idToken: yield* mintIdToken({ shop: SHOP }),
      billingRedirect: true,
    });
    assert.strictEqual(outcome._tag, "Threw");
    const failure = (
      outcome as { readonly value: { readonly _tag: string; readonly href: string } }
    ).value;
    assert.strictEqual(failure._tag, "PlanUnsubscribedError");
    assert.include(failure.href, "/auth/exit-iframe");
  }),
);

test(
  "authenticateMerchant over BACKEND: a token that does not verify arrives as InvalidIdTokenError",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    const outcome = yield* call(websiteUrl, "authenticateMerchant", {
      idToken: yield* mintIdToken({ shop: SHOP, apiSecret: "another-secret" }),
    });
    assert.deepStrictEqual(outcome, { _tag: "Threw", value: { _tag: "InvalidIdTokenError" } });
  }),
);

test(
  "appHome over BACKEND: after a first install, the shop, the catalog's first plan and the install instant",
  Effect.gen(function* () {
    const { backendUrl, websiteUrl } = yield* fresh;
    yield* door(backendUrl, (client) => client.InstallShopify({ shop: SHOP }));
    const before = DateTime.nowUnsafe();
    yield* call(websiteUrl, "authenticateMerchant", {
      idToken: yield* mintIdToken({ shop: SHOP }),
    });
    const outcome = yield* call(websiteUrl, "appHome", {
      idToken: yield* mintIdToken({ shop: SHOP }),
    });
    assert.strictEqual(outcome._tag, "Returned");
    const value = (
      outcome as {
        readonly value: {
          readonly shop: string;
          readonly planHandle: string;
          readonly installedAt: string;
        };
      }
    ).value;
    assert.strictEqual(value.shop, SHOP);
    assert.strictEqual(value.planHandle, "testbed-basic");
    const installedAt = Schema.decodeUnknownSync(Schema.DateTimeUtcFromString)(value.installedAt);
    assert.isTrue(DateTime.isGreaterThanOrEqualTo(installedAt, before));
  }),
);

test(
  "a signed app/uninstalled through the Website's /webhooks/* forward deletes the row; an unsigned one is refused",
  Effect.gen(function* () {
    const { backendUrl, websiteUrl } = yield* fresh;
    yield* door(backendUrl, (client) =>
      client.Seed({ row: { shop: SHOP, shopGid: SHOP_GID, scope: "" } }),
    );
    const url = new URL("webhooks/app/uninstalled", websiteUrl).href;
    assert.strictEqual(
      yield* deliverWebhook(url, "app/uninstalled", SHOP, {}, { signed: false }),
      401,
    );
    assert.isNotNull(yield* door(backendUrl, (client) => client.Stored({ shop: SHOP })));
    assert.strictEqual(yield* deliverWebhook(url, "app/uninstalled", SHOP, {}), 200);
    assert.isNull(yield* door(backendUrl, (client) => client.Stored({ shop: SHOP })));
  }),
);

test(
  "the testbed's shop/update through the Website's forward: 200",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    assert.strictEqual(
      yield* deliverWebhook(new URL("webhooks/shop/update", websiteUrl).href, "shop/update", SHOP, {
        id: 9,
      }),
      200,
    );
  }),
);

test(
  "the daily cron, triggered through workerd's scheduled route, revalidates a stale plan",
  Effect.gen(function* () {
    const { backendUrl } = yield* fresh;
    const now = DateTime.nowUnsafe();
    yield* door(backendUrl, (client) =>
      client.Seed({
        row: {
          shop: SHOP,
          shopGid: SHOP_GID,
          scope: "",
          planHandle: catalog.handles[0],
          planHandleExpiresAt: DateTime.subtractDuration(now, Duration.minutes(1)),
        },
      }),
    );
    const response = yield* Effect.promise(() =>
      fetch(
        new URL(`cdn-cgi/handler/scheduled?cron=${encodeURIComponent("17 4 * * *")}`, backendUrl),
      ),
    );
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(yield* door(backendUrl, (client) => client.PartnerAsked({})), [
      SHOP_GID,
    ]);
    const row = yield* door(backendUrl, (client) => client.Stored({ shop: SHOP }));
    assert.isNotNull(row);
    assert.isTrue(
      row !== null &&
        row.planHandleExpiresAt !== null &&
        DateTime.isGreaterThan(row.planHandleExpiresAt, now),
    );
  }),
);
