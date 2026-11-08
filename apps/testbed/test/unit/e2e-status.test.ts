import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { ShopDomain, ShopGid } from "@mw10013/shopify-app-workers/backend";
import { ShopifyAppTest } from "@mw10013/shopify-app-workers/test/node";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schema from "effect/Schema";

import { testbedApp } from "#backend/app.ts";
import { E2E_STATUS_PATH, e2eStatus } from "#e2e/status.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));
const SHOP = Schema.decodeUnknownSync(ShopDomain)("status-shop.myshopify.com");
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/12");

const testbed = () =>
  ShopifyAppTest.layer({
    app: testbedApp,
    migrationsDir,
    seed: [
      {
        shop: SHOP,
        shopGid: SHOP_GID,
        scope: "",
        planHandle: "testbed-pro",
        planHandleExpiresAt: DateTime.makeUnsafe(Duration.toMillis(Duration.days(1))),
      },
    ],
  });

/** The route's answer to `search` as the Website would receive it. */
const ask = (search: string, method = "GET") =>
  Effect.gen(function* () {
    const serve = yield* e2eStatus;
    const request = new Request(`http://backend${E2E_STATUS_PATH}${search}`, { method });
    const response = yield* serve.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(request),
      ),
    );
    const web = HttpServerResponse.toWeb(response);
    return { status: web.status, body: yield* Effect.promise(() => web.text()) };
  });

describe("the e2e status route", () => {
  it.effect("an installed shop: its row's plan handle and when it was inserted", () =>
    Effect.gen(function* () {
      const { status, body } = yield* ask(`?shop=${SHOP}`);
      assert.strictEqual(status, 200);
      // The seed's insert ran at the test clock's start.
      assert.deepStrictEqual(JSON.parse(body), {
        shop: SHOP,
        installed: true,
        planHandle: "testbed-pro",
        installedAt: DateTime.formatIso(DateTime.makeUnsafe(0)),
      });
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("a shop with no row: not installed, no plan, no install instant", () =>
    Effect.gen(function* () {
      const { status, body } = yield* ask("?shop=other-shop.myshopify.com");
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(JSON.parse(body), {
        shop: "other-shop.myshopify.com",
        installed: false,
        planHandle: null,
        installedAt: null,
      });
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("no shop, or one that is not a myshopify.com domain: 400", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* ask("")).status, 400);
      assert.strictEqual((yield* ask("?shop=example.com")).status, 400);
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("anything but GET: 405", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, "POST")).status, 405);
    }).pipe(Effect.provide(testbed())),
  );
});
