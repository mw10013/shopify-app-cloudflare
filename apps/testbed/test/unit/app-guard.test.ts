import { assert, describe, it } from "@effect/vitest";
import { isRedirect } from "@tanstack/react-router";
import * as Option from "effect/Option";

import { type AppGuardReads, documentGuard, navigationGuard } from "#web/routes/-app-guard.ts";
import {
  appSearch,
  documentHeaders,
  embeddedAppUrl,
  exitIframeDestination,
  idTokenBounce,
} from "#web/server/shopify-urls.ts";

const APP_URL = "https://testbed.example.com";
const API_KEY = "api-key";
const SHOP = "guard-shop.myshopify.com";
/** `admin.shopify.com/store/guard-shop`, unpadded, as Shopify sends `host`. */
const HOST = btoa("admin.shopify.com/store/guard-shop").replaceAll("=", "");
const CONTEXT = { shop: SHOP, apiKey: API_KEY, managePlanUrl: "https://manage" };

type AuthenticateInput = Parameters<AppGuardReads["authenticateApp"]>[0];

/** Reads that record each `authenticateApp` call; `bearer` is whether the document carried one. */
const reads = (bearer = false) => {
  const calls: AuthenticateInput[] = [];
  const value: AppGuardReads = {
    getShopifyApp: () => Promise.resolve({ apiKey: API_KEY, appUrl: APP_URL }),
    authenticateApp: (input) => {
      calls.push(input);
      return Promise.resolve(CONTEXT);
    },
    documentHasBearer: () => bearer,
  };
  return { calls, value };
};

const location = (searchStr: string) => ({ pathname: "/app", searchStr });

/** The href of the redirect the guard threw; fails if it answered instead. */
const redirectHref = async (run: Promise<unknown>) => {
  const thrown = await run.then(
    () => assert.fail("the guard answered"),
    (error: unknown) => error,
  );
  assert.isTrue(isRedirect(thrown));
  return isRedirect(thrown) ? (thrown.options.href ?? "") : "";
};

const launch = (extra = "") => `?embedded=1&host=${HOST}&shop=${SHOP}&id_token=the-token${extra}`;

describe("documentGuard", () => {
  it("authenticates an embedded launch with its id_token", async () => {
    const { calls, value } = reads();
    assert.deepStrictEqual(await documentGuard(value)({ location: location(launch()) }), CONTEXT);
    assert.deepStrictEqual(calls, [{ data: { idToken: "the-token", billingRedirect: false } }]);
  });

  it("Shopify's billing redirect, with plan_handle, re-reads the plan", async () => {
    const { calls, value } = reads();
    await documentGuard(value)({ location: location(launch("&plan_handle=testbed-pro")) });
    assert.deepStrictEqual(calls, [{ data: { idToken: "the-token", billingRedirect: true } }]);
  });

  it("a document with a bearer is authenticated by it alone, with no search checks", async () => {
    const { calls, value } = reads(true);
    await documentGuard(value)({ location: location("?plan_handle=testbed-basic") });
    assert.deepStrictEqual(calls, [{ data: { billingRedirect: true } }]);
  });

  it("a document with neither shop nor host goes to the ID token bounce", async () => {
    const { calls, value } = reads();
    const href = await redirectHref(documentGuard(value)({ location: location("") }));
    assert.strictEqual(href, idTokenBounce(APP_URL, "/app", ""));
    assert.deepStrictEqual(calls, []);
  });

  it("shop without host is re-embedded", async () => {
    const { value } = reads();
    const href = await redirectHref(documentGuard(value)({ location: location(`?shop=${SHOP}`) }));
    assert.strictEqual(href, `/auth/session-token?shop=${SHOP}`);
  });

  it("a launch outside the Shopify admin goes into it", async () => {
    const { value } = reads();
    const href = await redirectHref(
      documentGuard(value)({ location: location(`?host=${HOST}&shop=${SHOP}`) }),
    );
    assert.strictEqual(href, `https://admin.shopify.com/store/guard-shop/apps/${API_KEY}`);
  });

  it("an embedded launch without id_token goes to the ID token bounce", async () => {
    const { calls, value } = reads();
    const search = `?embedded=1&host=${HOST}&shop=${SHOP}`;
    const href = await redirectHref(documentGuard(value)({ location: location(search) }));
    assert.strictEqual(href, idTokenBounce(APP_URL, "/app", search));
    assert.deepStrictEqual(calls, []);
  });
});

describe("navigationGuard", () => {
  it("asks with the bearer App Bridge adds, never as the billing redirect", async () => {
    const { calls, value } = reads();
    assert.deepStrictEqual(await navigationGuard(value)(), CONTEXT);
    assert.deepStrictEqual(calls, [{ data: { billingRedirect: false } }]);
  });
});

describe("shopify-urls", () => {
  it("idTokenBounce drops id_token and names the page to reload", () => {
    const bounce = new URL(idTokenBounce(APP_URL, "/app", `?shop=${SHOP}&id_token=old`), APP_URL);
    assert.strictEqual(bounce.pathname, "/auth/session-token");
    assert.isNull(bounce.searchParams.get("id_token"));
    assert.strictEqual(bounce.searchParams.get("shopify-reload"), `${APP_URL}/app?shop=${SHOP}`);
  });

  it("embeddedAppUrl reads an unpadded host and refuses one that names no Shopify admin", () => {
    assert.deepStrictEqual(
      embeddedAppUrl(HOST, API_KEY),
      Option.some(`https://admin.shopify.com/store/guard-shop/apps/${API_KEY}`),
    );
    assert.isTrue(Option.isNone(embeddedAppUrl(btoa("evil.example.com"), API_KEY)));
  });

  it("exitIframeDestination admits the app's origin and plan selection, nothing else", () => {
    const pricing =
      "https://admin.shopify.com/store/guard-shop/charges/workers-testbed-dev/pricing_plans";
    assert.strictEqual(Option.getOrThrow(exitIframeDestination(APP_URL, pricing)).href, pricing);
    assert.strictEqual(
      Option.getOrThrow(exitIframeDestination(APP_URL, "/app?shop=x")).href,
      `${APP_URL}/app?shop=x`,
    );
    for (const refused of [
      "https://evil.example.com/",
      `${pricing}?next=https://evil.example.com`,
      "https://admin.shopify.com/store/guard-shop/settings",
      "https://user:pass@testbed.example.com/app",
    ])
      assert.isTrue(Option.isNone(exitIframeDestination(APP_URL, refused)), refused);
  });

  it("documentHeaders frames only a page with a valid shop", () => {
    assert.deepStrictEqual(documentHeaders("not a shop"), {});
    assert.include(
      documentHeaders(SHOP)["Content-Security-Policy"],
      `frame-ancestors https://${SHOP}`,
    );
  });

  it("appSearch reads the text Shopify sent, plan_handle included", () => {
    assert.deepStrictEqual(appSearch(`?embedded=1&plan_handle=testbed-pro`), {
      embedded: "1",
      plan_handle: "testbed-pro",
    });
  });
});
