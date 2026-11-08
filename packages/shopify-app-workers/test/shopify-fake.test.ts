import { assert, describe, it } from "@effect/vitest";
import { abstractFetch } from "@shopify/shopify-api/runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { REFRESH_GRANT, ShopifyFake, TOKEN_EXCHANGE_GRANT } from "#test/shopify-fake.ts";

import { SHOP } from "./fixtures.ts";

const TOKEN_URL = `https://${SHOP}/admin/oauth/access_token`;

/** A grant as the library sends it, through whatever fetch is installed. */
const grant = (body: Record<string, string>) =>
  Effect.promise(async () => {
    const response = await abstractFetch(TOKEN_URL, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  });

const exchange = grant({ grant_type: TOKEN_EXCHANGE_GRANT, subject_token: "id-token" });
const refresh = (refreshToken: string) =>
  grant({ grant_type: REFRESH_GRANT, refresh_token: refreshToken });

const refreshed = (refreshToken: string) =>
  Effect.map(refresh(refreshToken), ({ status, body }) => {
    assert.strictEqual(status, 200);
    return String(body.refresh_token);
  });

describe("ShopifyFake's ledger", () => {
  it.effect("rule 2: an exchange retires every other refresh token for the shop", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.recognize(SHOP, "shprt_seeded");
      const { body } = yield* exchange;
      assert.strictEqual(body.refresh_token, "shprt_1");
      assert.isFalse(yield* fake.accepts(SHOP, "shprt_seeded"));
      assert.isTrue(yield* fake.accepts(SHOP, "shprt_1"));
      assert.deepStrictEqual(yield* refresh("shprt_seeded"), {
        status: 401,
        body: { error: "invalid_request" },
      });
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );

  it.effect("rule 3: a presented refresh token stays usable until its successor is presented", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.recognize(SHOP, "shprt_seeded");
      const first = yield* refreshed("shprt_seeded");
      assert.isTrue(yield* fake.accepts(SHOP, "shprt_seeded"), "until its successor is used");
      // The successor's response was lost; the same token refreshes again.
      const again = yield* refreshed("shprt_seeded");
      assert.notStrictEqual(again, first);
      yield* refreshed(again);
      assert.isFalse(yield* fake.accepts(SHOP, "shprt_seeded"), "its successor was used");
      assert.strictEqual((yield* refresh("shprt_seeded")).status, 401);
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );

  it.effect("a refresh token the ledger never saw is answered 401", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* refresh("shprt_unknown")).status, 401);
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );

  it.effect("each shop keeps its own tokens", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* exchange;
      assert.isFalse(yield* fake.accepts("other-shop.myshopify.com" as typeof SHOP, "shprt_1"));
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );
});

describe("ShopifyFake's scripts", () => {
  it.effect("a scripted reply answers one call before the ledger, and every call is recorded", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.script([{ route: "token", status: 503, body: { error: "down" } }]);
      assert.strictEqual((yield* exchange).status, 503);
      assert.strictEqual((yield* exchange).status, 200);
      assert.deepStrictEqual(yield* fake.calls, [
        { route: "token", shop: SHOP, grantType: TOKEN_EXCHANGE_GRANT },
        { route: "token", shop: SHOP, grantType: TOKEN_EXCHANGE_GRANT },
      ]);
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );

  it.effect("a text reply is sent as it is, not as JSON", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.script([{ route: "token", status: 502, text: "<html>Bad gateway</html>" }]);
      const text = yield* Effect.promise(async () =>
        (await abstractFetch(TOKEN_URL, { method: "POST", body: "{}" })).text(),
      );
      assert.strictEqual(text, "<html>Bad gateway</html>");
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );

  it.effect("a network error rejects the fetch", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.script([{ route: "token", networkError: true }]);
      const failed = yield* Effect.tryPromise(() =>
        abstractFetch(TOKEN_URL, { method: "POST" }),
      ).pipe(Effect.flip);
      assert.instanceOf(failed.cause, TypeError);
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );

  it.effect("a URL that is not Shopify's is answered 599", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => abstractFetch("https://example.com/"));
      assert.strictEqual(response.status, 599);
    }).pipe(Effect.provide(ShopifyFake.layer)),
  );

  it.effect("the library's fetch is restored when the fake's layer is released", () =>
    Effect.gen(function* () {
      const before = abstractFetch;
      const during = yield* Effect.scoped(
        Effect.map(Layer.build(ShopifyFake.layer), () => abstractFetch),
      );
      assert.notStrictEqual(during, before);
      assert.strictEqual(abstractFetch, before);
    }),
  );
});
