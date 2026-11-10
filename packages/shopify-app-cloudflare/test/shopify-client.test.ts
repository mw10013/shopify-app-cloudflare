import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { ShopifyClient } from "#internal/shopify-client.ts";
import {
  FAKE_SHOPIFY_API_KEY,
  FAKE_SHOPIFY_API_SECRET,
  FAKE_SHOPIFY_CREDENTIALS,
} from "#test/fake-app.ts";
import { mintIdToken } from "#test/id-token.ts";
import { signWebhook } from "#test/webhook.ts";

import { SHOP } from "./fixtures.ts";
import { capturingLogs, type Logged } from "./logs.ts";

const layer = ShopifyClient.layer(FAKE_SHOPIFY_CREDENTIALS);
const fakeApp = { apiKey: FAKE_SHOPIFY_API_KEY, apiSecret: FAKE_SHOPIFY_API_SECRET };

/** A delivery of `payload`, signed; `headers` overrides or, with `null`, drops a signed header. */
const webhookRequest = ({
  topic = "app/uninstalled",
  payload = { id: 1 },
  method = "POST",
  headers = {},
}: {
  topic?: string;
  payload?: unknown;
  method?: string;
  headers?: Record<string, string | null>;
} = {}) =>
  Effect.gen(function* () {
    const body = JSON.stringify(payload);
    const signed = new Headers(yield* signWebhook(topic, SHOP, body));
    for (const [name, value] of Object.entries(headers))
      if (value === null) signed.delete(name);
      else signed.set(name, value);
    return new Request("https://example.com/webhooks/app/uninstalled", {
      method,
      headers: signed,
      body: method === "POST" ? body : undefined,
    });
  });

/** `request` through `validateWebhook`: its rejection status and every line it logged. */
const rejection = (request: Effect.Effect<Request>) =>
  Effect.gen(function* () {
    const client = yield* ShopifyClient;
    const logged: Logged[] = [];
    const error = yield* client
      .validateWebhook(yield* request)
      .pipe(Effect.flip, capturingLogs(logged));
    return { status: error.status, levels: logged.map(({ level }) => level) };
  });

describe("ShopifyClient.decodeIdToken", () => {
  it.effect("a signed token decodes to its shop and staff member", () =>
    Effect.gen(function* () {
      const client = yield* ShopifyClient;
      const decoded = yield* client.decodeIdToken(yield* mintIdToken({ shop: SHOP, sub: "42" }));
      assert.deepStrictEqual(decoded, { shop: SHOP, sub: "42" });
    }).pipe(Effect.provide(layer)),
  );

  it.effect.each([
    {
      name: "34: an ID token signed with another secret",
      token: mintIdToken({ shop: SHOP, ...fakeApp, apiSecret: "another-secret" }),
    },
    {
      name: "35: an ID token whose iss and dest name different shops",
      token: mintIdToken({ shop: SHOP, iss: "https://other-shop.myshopify.com/admin" }),
    },
    { name: "a wrong aud", token: mintIdToken({ shop: SHOP, ...fakeApp, apiKey: "other-key" }) },
    { name: "an expired token", token: mintIdToken({ shop: SHOP, expiresIn: -10 }) },
    { name: "a malformed token", token: Effect.succeed("not.a-token") },
  ])("$name fails InvalidIdTokenError", ({ token }) =>
    Effect.gen(function* () {
      const client = yield* ShopifyClient;
      const error = yield* client.decodeIdToken(yield* token).pipe(Effect.flip);
      assert.strictEqual(error._tag, "InvalidIdTokenError");
    }).pipe(Effect.provide(layer)),
  );
});

describe("ShopifyClient.validateWebhook", () => {
  it.effect("a signed delivery answers its shop, the header's topic and the parsed payload", () =>
    Effect.gen(function* () {
      const client = yield* ShopifyClient;
      const delivered = yield* client.validateWebhook(
        yield* webhookRequest({
          topic: "app/scopes_update",
          payload: { current: ["read_orders"] },
        }),
      );
      assert.strictEqual(delivered.shop, SHOP);
      assert.strictEqual(delivered.topic, "app/scopes_update");
      assert.deepStrictEqual(delivered.payload, { current: ["read_orders"] });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("N1: a failed HMAC answers 401 and logs at Error", () =>
    Effect.gen(function* () {
      const result = yield* rejection(
        webhookRequest({ headers: { "x-shopify-hmac-sha256": "not-a-valid-hmac" } }),
      );
      assert.deepStrictEqual(result, { status: 401, levels: ["Error"] });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("N1: a delivery signed with another secret answers 401 and logs at Error", () =>
    Effect.gen(function* () {
      const body = JSON.stringify({ id: 1 });
      const headers = yield* signWebhook("app/uninstalled", SHOP, body, {
        apiSecret: "another-secret",
      });
      const result = yield* rejection(
        Effect.succeed(
          new Request("https://example.com/webhooks", { method: "POST", headers, body }),
        ),
      );
      assert.deepStrictEqual(result, { status: 401, levels: ["Error"] });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("N2: a missing HMAC header answers 400 and logs at Debug", () =>
    Effect.gen(function* () {
      const result = yield* rejection(
        webhookRequest({ headers: { "x-shopify-hmac-sha256": null } }),
      );
      assert.deepStrictEqual(result, { status: 400, levels: ["Debug"] });
    }).pipe(Effect.provide(layer)),
  );

  it.effect.each([
    "x-shopify-topic",
    "x-shopify-shop-domain",
    "x-shopify-api-version",
    "x-shopify-webhook-id",
  ])("a delivery without %s answers 400 at Debug", (header) =>
    Effect.gen(function* () {
      const result = yield* rejection(webhookRequest({ headers: { [header]: null } }));
      assert.deepStrictEqual(result, { status: 400, levels: ["Debug"] });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a request that is not a POST answers 405 at Debug", () =>
    Effect.gen(function* () {
      const result = yield* rejection(webhookRequest({ method: "GET" }));
      assert.deepStrictEqual(result, { status: 405, levels: ["Debug"] });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a signed shop domain that is not a ShopDomain answers 400 at Warning", () =>
    Effect.gen(function* () {
      const result = yield* rejection(
        webhookRequest({ headers: { "x-shopify-shop-domain": "example.com" } }),
      );
      assert.deepStrictEqual(result, { status: 400, levels: ["Warn"] });
    }).pipe(Effect.provide(layer)),
  );
});

describe("ShopifyClient.layer", () => {
  it.effect(
    "builds the library only on first use, so a stack plan without credentials builds",
    () =>
      Effect.gen(function* () {
        yield* ShopifyClient;
      }).pipe(
        Effect.provide(
          ShopifyClient.layer({ apiKey: "", apiSecret: Redacted.make(""), appUrl: "" }),
        ),
      ),
  );
});
