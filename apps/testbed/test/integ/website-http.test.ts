import { createHash } from "node:crypto";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { assert } from "@effect/vitest";
import { ShopDomain, ShopGid } from "@mw10013/shopify-app-workers/contract";
import { fakePlanSelectionUrl, mintIdToken } from "@mw10013/shopify-app-workers/test";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { toJSONAsync } from "seroval";

import { door } from "./door.ts";
import { fileStage } from "./file-stage.ts";
import Stack from "./website-stack.ts";

/**
 * The built Website's HTTP answers in workerd, over the test Backend: the App Home's refusals as
 * `shopify-auth.md` gives them (the bearer's `401` and retry header, a browser server function's
 * bare `401`, a document's ID token bounce), the way to plan selection, `/auth/exit-iframe`, and
 * the outage page. What a browser does with them (App Bridge's retry, the router following a
 * `reloadDocument` redirect, hydration) is the e2e pack's.
 */
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: fileStage("websitehttp"),
});

const stack = beforeAll(deploy(Stack));
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack));

const SHOP = Schema.decodeUnknownSync(ShopDomain)("http-shop.myshopify.com");
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/11");
/** `admin.shopify.com/store/http-shop`, unpadded, as Shopify sends `host`. */
const HOST = btoa("admin.shopify.com/store/http-shop").replaceAll("=", "");
const RETRY = "X-Shopify-Retry-Invalid-Session-Request";

/** The stack, its door reset first. */
const fresh = Effect.gen(function* () {
  const urls = yield* stack;
  yield* door(urls.backendUrl, (client) => client.Reset({}));
  return urls;
});

/** A row with a fresh access token, so the guard does not exchange, and `answer` scripted. */
const seedWithPartner = (
  backendUrl: string,
  answer: { readonly _tag: "None" } | { readonly _tag: "Failure"; readonly reason: "partner-down" },
) =>
  Effect.gen(function* () {
    yield* door(backendUrl, (client) => client.ScriptPartner({ shopGid: SHOP_GID, answer }));
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
  });

const get = (url: URL, headers: Record<string, string> = {}) =>
  Effect.promise(() => fetch(url, { headers, redirect: "manual" }));

/**
 * A production build's server function id: the SHA-256 of `<file>--<name>_createServerFn_handler`
 * (`start-plugin-core` `src/start-compiler/compiler.ts`).
 */
const serverFnId = (name: string) =>
  createHash("sha256")
    .update(`src/web/server/shopify.ts--${name}_createServerFn_handler`)
    .digest("hex");

/**
 * `authenticateApp` as the browser's client calls it: a same-origin POST to `/_serverFn/<id>`,
 * marked `x-tsr-serverFn`, its `{ data }` in Seroval's JSON.
 */
const callAuthenticateApp = (websiteUrl: string, bearer?: string) =>
  Effect.promise(async () =>
    fetch(new URL(`/_serverFn/${serverFnId("authenticateApp")}`, websiteUrl), {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-tsr-serverFn": "true",
        origin: new URL(websiteUrl).origin,
        "sec-fetch-site": "same-origin",
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(await toJSONAsync({ data: { billingRedirect: false } })),
    }),
  );

/** The App Home as the Shopify admin embeds it. */
const appHome = (websiteUrl: string, idToken?: string) => {
  const url = new URL("/app", websiteUrl);
  url.search = new URLSearchParams({
    shop: SHOP,
    host: HOST,
    embedded: "1",
    ...(idToken === undefined ? {} : { id_token: idToken }),
  }).toString();
  return url;
};

const badToken = mintIdToken({ shop: SHOP, apiSecret: "another-secret" });

test(
  "a server function with a refused bearer: 401 and the retry header",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    const response = yield* callAuthenticateApp(websiteUrl, yield* badToken);
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.headers.get(RETRY), "1");
  }),
);

test(
  "a browser's server function with no token: a bare 401",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    const response = yield* callAuthenticateApp(websiteUrl);
    assert.strictEqual(response.status, 401);
    assert.isNull(response.headers.get(RETRY));
  }),
);

test(
  "a document with a refused bearer: 401 and the retry header",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    const response = yield* get(appHome(websiteUrl), {
      authorization: `Bearer ${yield* badToken}`,
    });
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.headers.get(RETRY), "1");
  }),
);

test(
  "a document: no id_token, and a refused one, each go to the ID token bounce",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    for (const idToken of [undefined, yield* badToken]) {
      const response = yield* get(appHome(websiteUrl, idToken));
      assert.strictEqual(response.status, 307, String(idToken));
      const bounce = new URL(response.headers.get("location") ?? "", websiteUrl);
      assert.strictEqual(bounce.pathname, "/auth/session-token");
      assert.isNull(bounce.searchParams.get("id_token"));
      const reload = new URL(bounce.searchParams.get("shopify-reload") ?? "");
      assert.strictEqual(reload.pathname, "/app");
      assert.strictEqual(reload.searchParams.get("shop"), SHOP);
      assert.isNull(reload.searchParams.get("id_token"));
    }
  }),
);

test(
  "the ID token bounce: App Bridge's page, framed for the shop",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    const response = yield* get(new URL(`/auth/session-token?shop=${SHOP}`, websiteUrl));
    assert.strictEqual(response.status, 200);
    assert.include(
      response.headers.get("content-security-policy") ?? "",
      `frame-ancestors https://${SHOP}`,
    );
    assert.include(yield* Effect.promise(() => response.text()), "app-bridge.js");
  }),
);

test(
  "an unsubscribed shop: the document and the server function each go to exit-iframe, the server function's redirect reloading the document",
  Effect.gen(function* () {
    const { backendUrl, websiteUrl } = yield* fresh;
    yield* seedWithPartner(backendUrl, { _tag: "None" });
    const idToken = yield* mintIdToken({ shop: SHOP });

    const document = yield* get(appHome(websiteUrl, idToken));
    assert.strictEqual(document.status, 307);
    const exit = new URL(document.headers.get("location") ?? "", websiteUrl);
    assert.strictEqual(exit.pathname, "/auth/exit-iframe");
    assert.strictEqual(exit.searchParams.get("exitIframe"), fakePlanSelectionUrl(SHOP));

    const call = yield* callAuthenticateApp(websiteUrl, idToken);
    const redirect = (yield* Effect.promise(() => call.json())) as {
      readonly href: string;
      readonly reloadDocument: boolean;
      readonly isSerializedRedirect: boolean;
    };
    assert.isTrue(redirect.isSerializedRedirect);
    assert.isTrue(redirect.reloadDocument);
    assert.strictEqual(new URL(redirect.href, websiteUrl).href, exit.href);
  }),
);

test(
  "/auth/exit-iframe: 400 for a refused destination; for plan selection, App Bridge and window.open to it",
  Effect.gen(function* () {
    const { websiteUrl } = yield* fresh;
    const exit = (destination: string) =>
      new URL(
        `/auth/exit-iframe?${new URLSearchParams({ exitIframe: destination, shop: SHOP }).toString()}`,
        websiteUrl,
      );
    assert.strictEqual((yield* get(exit("https://evil.example.com/"))).status, 400);
    const pricing = fakePlanSelectionUrl(SHOP);
    const response = yield* get(exit(pricing));
    assert.strictEqual(response.status, 200);
    const html = yield* Effect.promise(() => response.text());
    assert.include(html, "app-bridge.js");
    assert.include(html, `window.open(${JSON.stringify(pricing)}, "_top")`);
  }),
);

test(
  "a Partner outage: the document renders Shopify isn't responding, and its error crosses as ShopifyUnavailableError",
  Effect.gen(function* () {
    const { backendUrl, websiteUrl } = yield* fresh;
    yield* seedWithPartner(backendUrl, { _tag: "Failure", reason: "partner-down" });
    const idToken = yield* mintIdToken({ shop: SHOP });

    const document = yield* get(appHome(websiteUrl, idToken));
    const html = yield* Effect.promise(() => document.text());
    assert.include(html, "Shopify isn&#x27;t responding");
    // The dehydrated route error is the adapter's encoded error, which the browser decodes back
    // to the class; without the adapter it would be a bare Error with only a message.
    assert.include(html, "ShopifyUnavailableError");

    const call = yield* callAuthenticateApp(websiteUrl, idToken);
    const body = yield* Effect.promise(() => call.text());
    assert.include(body, "ShopifyUnavailableError");
    assert.include(body, SHOP);
  }),
);
