import { assert, describe, it } from "@effect/vitest";
import { abstractFetch, setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { AppTokens } from "#internal/app-tokens.ts";
import { FAKE_APP_TOKEN_KEY, FAKE_APP_TOKEN_KID, FAKE_SHOPIFY_API_KEY } from "#test/fake-app.ts";
import { FAKE_ACCESS_TOKEN_EXPIRES_IN, FAKE_SCOPE, ShopifyFake } from "#test/shopify-fake.ts";

import { SHOP } from "./fixtures.ts";

const TOKEN_URL = `https://${SHOP}/admin/oauth/access_token`;

const tokens = AppTokens.layer({
  clientId: FAKE_SHOPIFY_API_KEY,
  key: Redacted.make(FAKE_APP_TOKEN_KEY),
  kid: FAKE_APP_TOKEN_KID,
});
const layer = Layer.merge(tokens, ShopifyFake.layer);

const mint = Effect.flatMap(AppTokens, (appTokens) => appTokens.mint(SHOP));

/** A token request as `AppTokens` sends one, its form fields replaced or added by `over`. */
const post = (over: Record<string, string>) =>
  Effect.promise(async () => {
    const response = await abstractFetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: FAKE_SHOPIFY_API_KEY,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: "",
        ...over,
      }).toString(),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });

describe("ShopifyFake's token endpoint", () => {
  it.effect("an installed shop is minted a token with the installation's scope", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      const token = yield* mint;
      assert.strictEqual(token.scope, FAKE_SCOPE);
      assert.isTrue(yield* fake.accepts(SHOP, token.accessToken));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rule 4: a mint in the same minute answers the token already issued", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      const first = yield* mint;
      yield* TestClock.adjust("30 seconds");
      const again = yield* mint;
      assert.strictEqual(again.accessToken, first.accessToken);
      assert.deepStrictEqual(again.expires, first.expires, "with its original expiry");
      yield* TestClock.adjust("30 seconds");
      const next = yield* mint;
      assert.notStrictEqual(next.accessToken, first.accessToken);
      assert.isTrue(yield* fake.accepts(SHOP, first.accessToken), "minting retires nothing");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a token expires FAKE_ACCESS_TOKEN_EXPIRES_IN after it was issued", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      const { accessToken } = yield* mint;
      yield* TestClock.adjust(FAKE_ACCESS_TOKEN_EXPIRES_IN * 1000 - 1);
      assert.isTrue(yield* fake.accepts(SHOP, accessToken));
      yield* TestClock.adjust(1);
      assert.isFalse(yield* fake.accepts(SHOP, accessToken));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rule 6: a shop never installed, or uninstalled, answers app_not_installed", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      const exit = yield* Effect.flip(mint);
      assert.strictEqual(exit._tag, "AppNotInstalledError");
      yield* fake.install(SHOP);
      const { accessToken } = yield* mint;
      yield* fake.uninstall(SHOP);
      assert.isFalse(yield* fake.accepts(SHOP, accessToken), "its tokens end at once");
      assert.strictEqual((yield* Effect.flip(mint))._tag, "AppNotInstalledError");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rule 7: a replayed assertion answers 401 invalid_client", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      const served = abstractFetch;
      let sent = "";
      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          setAbstractFetchFunc((url, init) => {
            sent = typeof init?.body === "string" ? init.body : "";
            return served(url, init);
          });
        }),
        () => mint,
        () =>
          Effect.sync(() => {
            setAbstractFetchFunc(served);
          }),
      );
      const replayed = yield* Effect.promise(async () => {
        const response = await abstractFetch(TOKEN_URL, { method: "POST", body: sent });
        return { status: response.status, body: (await response.json()) as unknown };
      });
      assert.deepStrictEqual(replayed, { status: 401, body: { error: "invalid_client" } });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rule 7: an assertion signed with a key the fake does not hold answers 401", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      yield* fake.revokeKey(FAKE_APP_TOKEN_KID);
      const forged = [
        Base64Url.encode(JSON.stringify({ alg: "ES256", kid: FAKE_APP_TOKEN_KID })),
        Base64Url.encode(JSON.stringify({ iss: FAKE_SHOPIFY_API_KEY })),
        "c2ln",
      ].join(".");
      assert.deepStrictEqual(yield* post({ client_assertion: forged }), {
        status: 401,
        body: { error: "invalid_client" },
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rule 2: a client secret or a scope in the request answers 400", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      assert.strictEqual((yield* post({ client_secret: "secret" })).status, 400);
      assert.strictEqual((yield* post({ scope: "read_orders" })).status, 400);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rule 7: an unknown client id answers 400 application_cannot_be_found", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* post({ client_id: "0".repeat(32) }), {
        status: 400,
        body: { error: "application_cannot_be_found" },
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reset forgets installations and registers the fake app's key again", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      yield* fake.revokeKey(FAKE_APP_TOKEN_KID);
      yield* fake.reset;
      assert.strictEqual((yield* Effect.flip(mint))._tag, "AppNotInstalledError");
      yield* fake.install(SHOP);
      yield* mint;
    }).pipe(Effect.provide(layer)),
  );
});

describe("ShopifyFake's Admin GraphQL", () => {
  it.effect("answers a token it issued, and 401 for any other", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      const { accessToken } = yield* mint;
      const status = (token: string) =>
        Effect.promise(async () => {
          const response = await abstractFetch(`https://${SHOP}/admin/api/2026-10/graphql.json`, {
            method: "POST",
            headers: { "X-Shopify-Access-Token": token },
            body: "{}",
          });
          return response.status;
        });
      assert.strictEqual(yield* status(accessToken), 200);
      assert.strictEqual(yield* status("shpat_unknown"), 401);
      yield* fake.recognize(SHOP, "shpat_seeded", Date.now() + 60_000);
      assert.strictEqual(yield* status("shpat_seeded"), 200);
    }).pipe(Effect.provide(layer)),
  );
});

describe("ShopifyFake's scripts", () => {
  it.effect("a scripted reply answers one call first, and every call is recorded", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.install(SHOP);
      yield* fake.script([{ route: "token", status: 503, body: { error: "down" } }]);
      assert.strictEqual((yield* post({})).status, 503);
      assert.strictEqual((yield* post({})).status, 401);
      const recorded = yield* fake.calls;
      assert.deepStrictEqual(
        recorded.map((call) => call.route),
        ["token", "token"],
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a text reply is sent as it is, not as JSON", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.script([{ route: "token", status: 502, text: "<html>Bad gateway</html>" }]);
      const text = yield* Effect.promise(async () =>
        (await abstractFetch(TOKEN_URL, { method: "POST", body: "" })).text(),
      );
      assert.strictEqual(text, "<html>Bad gateway</html>");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a network error rejects the fetch", () =>
    Effect.gen(function* () {
      const fake = yield* ShopifyFake;
      yield* fake.script([{ route: "token", networkError: true }]);
      const failed = yield* Effect.tryPromise(() =>
        abstractFetch(TOKEN_URL, { method: "POST" }),
      ).pipe(Effect.flip);
      assert.instanceOf(failed.cause, TypeError);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a URL that is not Shopify's is answered 599", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => abstractFetch("https://example.com/"));
      assert.strictEqual(response.status, 599);
    }).pipe(Effect.provide(layer)),
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
