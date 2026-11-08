import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { PlanCatalog, ShopDomain, ShopGid, ShopifyApp } from "@mw10013/shopify-app-workers/backend";
import { E2E_WEBHOOK_MARKER_PARAM } from "@mw10013/shopify-app-workers/contract";
import { type BindableWorker, bindE2eSession } from "@mw10013/shopify-app-workers/stack";
import { ShopifyAppTest } from "@mw10013/shopify-app-workers/test/node";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { e2eStatus, e2eWebhooks, tokenMatches, withE2eRoutes } from "#test/e2e-backend.ts";
import {
  E2E_SESSION_BINDING,
  E2E_SESSION_FILE,
  E2E_STATUS_PATH,
  E2E_TOKEN_HEADER,
  E2E_WEBHOOKS_PATH,
  type E2eAccess,
} from "#test/e2e-session.ts";

const SHOP = Schema.decodeUnknownSync(ShopDomain)("status-shop.myshopify.com");
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/12");
const OTHER_SHOP = Schema.decodeUnknownSync(ShopDomain)("other-shop.myshopify.com");
const TOKEN = "a".repeat(64);
const access = (shop: ShopDomain = SHOP): Option.Option<E2eAccess> =>
  Option.some({ token: Redacted.make(TOKEN), shop });

const app = ShopifyApp.define({ catalog: PlanCatalog.make({ "testbed-pro": {} }) });

const installed = () =>
  ShopifyAppTest.layer({
    app,
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
    }).pipe(Effect.provide(installed())),
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
    }).pipe(Effect.provide(installed())),
  );

  it.effect("no shop, or one that is not a myshopify.com domain: 400", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* ask("")).status, 400);
      assert.strictEqual((yield* ask("?shop=example.com")).status, 400);
    }).pipe(Effect.provide(installed())),
  );

  it.effect("anything but GET: 405", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { method: "POST" })).status, 405);
    }).pipe(Effect.provide(installed())),
  );

  it.effect("no token, a wrong one, or no session bound: 401, before anything else", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { token: null })).status, 401);
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { token: "b".repeat(64) })).status, 401);
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { token: "a" })).status, 401);
      assert.strictEqual((yield* ask("", { method: "POST", token: null })).status, 401);
      assert.strictEqual((yield* ask(`?shop=${SHOP}`, { session: Option.none() })).status, 401);
    }).pipe(Effect.provide(installed())),
  );

  it.effect("a shop other than the session's, an installed one included: 403", () =>
    Effect.gen(function* () {
      const { status, body } = yield* ask(`?shop=${SHOP}`, { session: access(OTHER_SHOP) });
      assert.strictEqual(status, 403);
      assert.notInclude(body, "testbed-pro");
    }).pipe(Effect.provide(installed())),
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

const webhook = (headers: Record<string, string>, url = "http://backend/webhooks/shop/update") =>
  HttpServerRequest.fromWeb(new Request(url, { method: "POST", headers, body: "{}" }));

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
      const { record, route } = yield* e2eWebhooks(access());
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
          {
            topic: "shop/update",
            webhookId: "w-1",
            shop: null,
            marker: null,
            status: 200,
            receivedAt: at,
          },
          { topic: null, webhookId: null, shop: null, marker: null, status: 401, receivedAt: at },
        ],
      });
    }),
  );

  it.effect("keeps each request's shop header and its marker query parameter", () =>
    Effect.gen(function* () {
      const { record, route } = yield* e2eWebhooks(access());
      yield* record(
        webhook(
          { "x-shopify-topic": "shop/redact", "x-shopify-shop-domain": "shop.myshopify.com" },
          `http://backend/webhooks/compliance?${E2E_WEBHOOK_MARKER_PARAM}=m-1`,
        ),
        HttpServerResponse.empty({ status: 200 }),
      );
      const { deliveries } = JSON.parse((yield* read(route)).body) as {
        deliveries: { shop: string | null; marker: string | null }[];
      };
      assert.deepStrictEqual(
        deliveries.map(({ shop, marker }) => ({ shop, marker })),
        [{ shop: "shop.myshopify.com", marker: "m-1" }],
      );
    }),
  );

  it.effect("keeps the 100 latest requests", () =>
    Effect.gen(function* () {
      const { record, route } = yield* e2eWebhooks(access());
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
      const { route } = yield* e2eWebhooks(access());
      assert.strictEqual((yield* read(route, { token: null })).status, 401);
      assert.strictEqual((yield* read(route, { token: "b".repeat(64) })).status, 401);
      assert.strictEqual((yield* read(route, { method: "POST", token: null })).status, 401);
      const unbound = yield* e2eWebhooks(Option.none());
      assert.strictEqual((yield* read(unbound.route)).status, 401);
      assert.strictEqual((yield* read(route, { method: "POST" })).status, 405);
    }),
  );
});

/** A Backend body: a webhook route that answers 200 and 404 elsewhere, and a binding method. */
const appBody = Effect.succeed({
  fetch: Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return HttpServerResponse.empty({
      status: new URL(request.url, "http://backend").pathname.startsWith("/webhooks/") ? 200 : 404,
    });
  }),
  ping: () => "pong",
});

describe("withE2eRoutes", () => {
  const sessionEnv = ConfigProvider.fromEnvRecord({ E2E_STATUS_TOKEN: TOKEN, E2E_SHOP: SHOP });
  const fetchOf =
    (
      fetch: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        never,
        HttpServerRequest.HttpServerRequest
      >,
    ) =>
    (url: string, headers: Record<string, string> = {}) =>
      fetch.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request(url, { method: "POST", headers, body: "{}" })),
        ),
        Effect.map((response) => response.status),
      );

  it.effect(
    "serves the e2e routes ahead of the app, records its webhook answers, keeps its methods",
    () =>
      Effect.gen(function* () {
        const backend = yield* withE2eRoutes(appBody);
        assert.strictEqual(backend.ping(), "pong");
        const ask = fetchOf(backend.fetch);
        assert.strictEqual(yield* ask("http://backend/other"), 404);
        assert.strictEqual(
          yield* ask("http://backend/webhooks/shop/update", { "x-shopify-topic": "shop/update" }),
          200,
        );
        assert.strictEqual(yield* ask(`http://backend${E2E_STATUS_PATH}?shop=${SHOP}`), 401);
        const web = HttpServerResponse.toWeb(
          yield* backend.fetch.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(
                new Request(`http://backend${E2E_WEBHOOKS_PATH}`, {
                  headers: { [E2E_TOKEN_HEADER]: TOKEN },
                }),
              ),
            ),
          ),
        );
        const { deliveries } = (yield* Effect.promise(() => web.json())) as {
          deliveries: { topic: string | null; status: number }[];
        };
        assert.deepStrictEqual(
          deliveries.map(({ topic, status }) => ({ topic, status })),
          [{ topic: "shop/update", status: 200 }],
        );
      }).pipe(
        Effect.provide(installed()),
        Effect.provideService(ConfigProvider.ConfigProvider, sessionEnv),
      ),
  );
});

describe("bindE2eSession", () => {
  const recording = () => {
    const bound: { readonly id: string; readonly env: Readonly<Record<string, unknown>> }[] = [];
    const worker: BindableWorker = {
      bind: (id, { env }) =>
        Effect.sync(() => {
          bound.push({ id, env });
        }),
    };
    return { bound, worker };
  };

  it.effect("binds the session file under the app's root, its token redacted", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(path.join(tmpdir(), "e2e-session-"));
      mkdirSync(path.join(root, path.dirname(E2E_SESSION_FILE)), { recursive: true });
      writeFileSync(
        path.join(root, E2E_SESSION_FILE),
        JSON.stringify({ token: TOKEN, shop: SHOP }),
      );
      const { bound, worker } = recording();
      yield* bindE2eSession(worker, root);
      assert.deepStrictEqual(
        bound.map(({ id }) => id),
        [E2E_SESSION_BINDING],
      );
      const env = bound[0]?.env ?? {};
      assert.strictEqual(env.E2E_SHOP, SHOP);
      assert.isTrue(Redacted.isRedacted(env.E2E_STATUS_TOKEN));
    }),
  );

  it.effect("binds nothing when no session was written", () =>
    Effect.gen(function* () {
      const { bound, worker } = recording();
      yield* bindE2eSession(worker, mkdtempSync(path.join(tmpdir(), "e2e-session-")));
      assert.deepStrictEqual(bound, []);
    }),
  );
});
