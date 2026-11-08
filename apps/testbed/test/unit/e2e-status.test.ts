import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { ShopDomain, ShopGid } from "@mw10013/shopify-app-workers/backend";
import { ShopifyAppTest } from "@mw10013/shopify-app-workers/test/node";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { testbedApp } from "#backend/app.ts";
import { E2E_TOKEN_HEADER, type E2eAccess } from "#e2e/session.ts";
import { E2E_STATUS_PATH, e2eStatus, tokenMatches } from "#e2e/status.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));
const SHOP = Schema.decodeUnknownSync(ShopDomain)("status-shop.myshopify.com");
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/12");
const OTHER_SHOP = Schema.decodeUnknownSync(ShopDomain)("other-shop.myshopify.com");
const TOKEN = "a".repeat(64);
const access = (shop: ShopDomain = SHOP): Option.Option<E2eAccess> =>
  Option.some({ token: Redacted.make(TOKEN), shop });

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

/** The route's answer to `search` as the Website would receive it; a `null` token sends none. */
const ask = (
  search: string,
  {
    method = "GET",
    token = TOKEN,
    session = access(),
  }: { method?: string; token?: string | null; session?: Option.Option<E2eAccess> } = {},
) =>
  Effect.gen(function* () {
    const serve = yield* e2eStatus(session);
    const headers: Record<string, string> = token === null ? {} : { [E2E_TOKEN_HEADER]: token };
    const request = new Request(`http://backend${E2E_STATUS_PATH}${search}`, { method, headers });
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
      const { status, body } = yield* ask(`?shop=${OTHER_SHOP}`, {
        session: access(OTHER_SHOP),
      });
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
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { method: "POST" })).status, 405);
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("no token, a wrong one, or no session bound: 401, before anything else", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { token: null })).status, 401);
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { token: "b".repeat(64) })).status, 401);
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { token: "a" })).status, 401);
      assert.strictEqual((yield* ask("", { method: "POST", token: null })).status, 401);
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { session: Option.none() })).status, 401);
    }).pipe(Effect.provide(testbed())),
  );

  it.effect("a shop other than the session's, an installed one included: 403", () =>
    Effect.gen(function* () {
      const { status, body } = yield* ask(`?shop=${SHOP}`, { session: access(OTHER_SHOP) });
      assert.strictEqual(status, 403);
      assert.notInclude(body, "testbed-pro");
    }).pipe(Effect.provide(testbed())),
  );
});

describe("tokenMatches", () => {
  it("only the same token matches", () => {
    const expected = Redacted.make(TOKEN);
    assert.isTrue(tokenMatches(expected, TOKEN));
    assert.isFalse(tokenMatches(expected, undefined));
    assert.isFalse(tokenMatches(expected, ""));
    assert.isFalse(tokenMatches(expected, `${TOKEN}a`));
    assert.isFalse(tokenMatches(expected, "b".repeat(64)));
  });
});
