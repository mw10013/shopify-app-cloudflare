import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { ShopDomain, ShopGid, Webhooks } from "@mw10013/shopify-app-cloudflare/backend";
import { signWebhook } from "@mw10013/shopify-app-cloudflare/test";
import { D1Test, ShopifyAppTest } from "@mw10013/shopify-app-cloudflare/test/node";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Schema from "effect/Schema";

import { testbedApp } from "#backend/app.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));
const SHOP = Schema.decodeUnknownSync(ShopDomain)("note-shop.myshopify.com");
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/7");

const deliver = (topic: string, payload: unknown) =>
  Effect.gen(function* () {
    const webhooks = yield* Webhooks;
    const body = JSON.stringify(payload);
    const request = new Request(`https://backend.test/webhooks/${topic}`, {
      method: "POST",
      headers: yield* signWebhook(topic, SHOP, body),
      body,
    });
    return (yield* webhooks.serve(HttpServerRequest.fromWeb(request))).status;
  });

describe("TestbedNote", () => {
  it.effect("goes with its shop's installation on app/uninstalled", () =>
    Effect.gen(function* () {
      const { sqlite } = yield* D1Test;
      sqlite
        .prepare("insert into TestbedNote (shop, body, createdAt) values (?, ?, ?)")
        .run(SHOP, "hello", 0);
      assert.strictEqual(yield* Effect.scoped(deliver("app/uninstalled", {})), 200);
      assert.deepStrictEqual(sqlite.prepare("select * from TestbedNote").all(), []);
      assert.deepStrictEqual(sqlite.prepare("select * from AppInstallation").all(), []);
    }).pipe(
      Effect.provide(
        ShopifyAppTest.layer({
          app: testbedApp,
          migrationsDir,
          seed: [{ shop: SHOP, shopGid: SHOP_GID }],
        }),
      ),
    ),
  );

  it.effect("shop/update, the testbed's extra topic, is answered 200", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* Effect.scoped(deliver("shop/update", { id: 7 })), 200);
    }).pipe(Effect.provide(ShopifyAppTest.layer({ app: testbedApp, migrationsDir }))),
  );
});
