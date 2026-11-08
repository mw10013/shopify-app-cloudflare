import { assert, describe, it } from "@effect/vitest";
import { ShopDomain } from "@mw10013/shopify-app-workers/backend";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { E2E_TOKEN_HEADER, type E2eAccess } from "#e2e/session.ts";
import { E2E_WEBHOOKS_PATH, e2eWebhooks } from "#e2e/webhooks.ts";

const TOKEN = "a".repeat(64);
const access: Option.Option<E2eAccess> = Option.some({
  token: Redacted.make(TOKEN),
  shop: Schema.decodeUnknownSync(ShopDomain)("record-shop.myshopify.com"),
});

const webhook = (headers: Record<string, string>) =>
  HttpServerRequest.fromWeb(
    new Request("http://backend/webhooks/shop/update", { method: "POST", headers, body: "{}" }),
  );

const read = (
  route: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>,
  { method = "GET", token = TOKEN }: { method?: string; token?: string | null } = {},
) =>
  Effect.gen(function* () {
    const headers: Record<string, string> = token === null ? {} : { [E2E_TOKEN_HEADER]: token };
    const request = new Request(`http://backend${E2E_WEBHOOKS_PATH}`, { method, headers });
    const web = HttpServerResponse.toWeb(yield* route(HttpServerRequest.fromWeb(request)));
    return { status: web.status, body: yield* Effect.promise(() => web.text()) };
  });

describe("the e2e webhook record", () => {
  it.effect("answers each recorded request's topic, webhook id and status, oldest first", () =>
    Effect.gen(function* () {
      const { record, route } = yield* e2eWebhooks(access);
      assert.deepStrictEqual(JSON.parse((yield* read(route)).body), { deliveries: [] });
      yield* record(
        webhook({ "x-shopify-topic": "shop/update", "x-shopify-webhook-id": "w-1" }),
        HttpServerResponse.empty({ status: 200 }),
      );
      yield* record(webhook({}), HttpServerResponse.empty({ status: 401 }));
      const { status, body } = yield* read(route);
      assert.strictEqual(status, 200);
      const at = DateTime.formatIso(DateTime.makeUnsafe(0));
      assert.deepStrictEqual(JSON.parse(body), {
        deliveries: [
          { topic: "shop/update", webhookId: "w-1", status: 200, receivedAt: at },
          { topic: null, webhookId: null, status: 401, receivedAt: at },
        ],
      });
    }),
  );

  it.effect("keeps the 100 latest requests", () =>
    Effect.gen(function* () {
      const { record, route } = yield* e2eWebhooks(access);
      for (let index = 0; index < 101; index += 1)
        yield* record(
          webhook({ "x-shopify-webhook-id": `w-${String(index)}` }),
          HttpServerResponse.empty({ status: 200 }),
        );
      const { deliveries } = JSON.parse((yield* read(route)).body) as {
        deliveries: { webhookId: string }[];
      };
      assert.strictEqual(deliveries.length, 100);
      assert.strictEqual(deliveries[0]?.webhookId, "w-1");
      assert.strictEqual(deliveries.at(-1)?.webhookId, "w-100");
    }),
  );

  it.effect("no token, a wrong one, or no session bound: 401; anything but GET: 405", () =>
    Effect.gen(function* () {
      const { route } = yield* e2eWebhooks(access);
      assert.strictEqual((yield* read(route, { token: null })).status, 401);
      assert.strictEqual((yield* read(route, { token: "b".repeat(64) })).status, 401);
      assert.strictEqual((yield* read(route, { method: "POST", token: null })).status, 401);
      const unbound = yield* e2eWebhooks(Option.none());
      assert.strictEqual((yield* read(unbound.route)).status, 401);
      assert.strictEqual((yield* read(route, { method: "POST" })).status, 405);
    }),
  );
});
