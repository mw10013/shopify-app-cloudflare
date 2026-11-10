import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { onTestFinished } from "vite-plus/test";

import { InvalidIdTokenError, PlanUnsubscribedError } from "#internal/contract.ts";
import {
  appGuard,
  type AppGuardReads,
  type AuthenticateAppInput,
  documentGuard,
  forgetAppGuard,
  readEmbeddedIdToken,
  type RedirectOptions,
} from "#internal/merchant-request.ts";
import {
  appSearch,
  documentHeaders,
  embeddedAppUrl,
  exitIframeDestination,
  idTokenBounce,
  inlineScriptString,
} from "#internal/shopify-urls.ts";

const APP_URL = "https://testbed.example.com";
const API_KEY = "api-key";
const SHOP = "guard-shop.myshopify.com";
/** `admin.shopify.com/store/guard-shop`, unpadded, as Shopify sends `host`. */
const HOST = btoa("admin.shopify.com/store/guard-shop").replaceAll("=", "");
const CONTEXT = { shop: SHOP, apiKey: API_KEY };

/** Stands in for TanStack's `redirect`: the options, thrown as they came. */
class Redirected {
  readonly options: RedirectOptions;
  constructor(options: RedirectOptions) {
    this.options = options;
  }
}
const redirect = (options: RedirectOptions) => new Redirected(options);

/** Plan selection, where `authenticateApp` sends a shop with no app subscription. */
const PLANS = "/auth/exit-iframe?exitIframe=plans";
/** Typed as the app's `Redirect` answers it. */
const toPlans: unknown = redirect({ href: PLANS, reloadDocument: true });

/**
 * Reads that record each `authenticateApp` call; `bearer` is whether the document carried one.
 * Clearing `shop.subscribed` makes `authenticateApp` throw as it does for an unsubscribed shop.
 */
const reads = (bearer = false) => {
  const calls: AuthenticateAppInput[] = [];
  const shop = { subscribed: true };
  const value: AppGuardReads<typeof CONTEXT> = {
    getShopifyApp: () => Promise.resolve({ apiKey: API_KEY, appUrl: APP_URL }),
    authenticateApp: (input) => {
      calls.push(input);
      return Promise.resolve().then(() => {
        if (!shop.subscribed) throw toPlans;
        return CONTEXT;
      });
    },
    documentHasBearer: () => bearer,
    redirect,
  };
  return { calls, shop, value };
};

const location = (searchStr: string) => ({ pathname: "/app", searchStr });

/** What `run` threw; fails if it answered instead. */
const thrown = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return assert.fail("it answered");
};

/** The href of the redirect the guard threw; fails if it answered instead. */
const redirectHref = async (run: Promise<unknown>) => {
  const error = await run.then(
    () => assert.fail("the guard answered"),
    (rejected: unknown) => rejected,
  );
  assert.instanceOf(error, Redirected);
  return error instanceof Redirected ? error.options.href : "";
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

describe("appGuard", () => {
  const registry = () => {
    const value = AtomRegistry.make();
    onTestFinished(() => {
      value.dispose();
    });
    return value;
  };
  const at = (registry: AtomRegistry.AtomRegistry, searchStr = "") => ({
    location: location(searchStr),
    context: { registry },
  });

  it("on the server authenticates the document, and an unsubscribed shop goes to plan selection", async () => {
    const { calls, shop, value } = reads();
    const { guard } = appGuard(value, { onServer: true });
    const r = registry();
    assert.deepStrictEqual(await guard(at(r, launch())), CONTEXT);
    shop.subscribed = false;
    const error = await guard(at(r, launch())).then(
      () => assert.fail("the guard answered"),
      (rejected: unknown) => rejected,
    );
    assert.deepStrictEqual(error, redirect({ href: PLANS, reloadDocument: true }));
    assert.deepStrictEqual(calls, [
      { data: { idToken: "the-token", billingRedirect: false } },
      { data: { idToken: "the-token", billingRedirect: false } },
    ]);
  });

  it("in the browser after hydration, a navigation makes no server call and keeps the document's answer", async () => {
    const { calls, value } = reads();
    const { guard, rememberHydrated } = appGuard(value, { onServer: false });
    const r = registry();
    rememberHydrated(r, CONTEXT);
    for (const _ of [1, 2, 3]) assert.deepStrictEqual(await guard(at(r)), CONTEXT);
    assert.deepStrictEqual(calls, []);
  });

  it("in the browser with no answer it asks once, and later navigations keep that answer", async () => {
    const { calls, value } = reads();
    const { guard } = appGuard(value, { onServer: false });
    const r = registry();
    assert.deepStrictEqual(await guard(at(r)), CONTEXT);
    assert.deepStrictEqual(await guard(at(r)), CONTEXT);
    assert.deepStrictEqual(calls, [{ data: { billingRedirect: false } }]);
  });

  it("a forgotten answer asks again, and an unsubscribed shop then goes to plan selection", async () => {
    const { calls, shop, value } = reads();
    const { guard, rememberHydrated } = appGuard(value, { onServer: false });
    const r = registry();
    rememberHydrated(r, CONTEXT);
    shop.subscribed = false;
    assert.deepStrictEqual(await guard(at(r)), CONTEXT);
    forgetAppGuard(r);
    assert.deepStrictEqual(await redirectHref(guard(at(r))), PLANS);
    assert.deepStrictEqual(calls, [{ data: { billingRedirect: false } }]);
  });
});

describe("readEmbeddedIdToken", () => {
  const request = (headers: Record<string, string>) =>
    new Request(`${APP_URL}/app?shop=${SHOP}`, { headers });
  const embedded = (headers: Record<string, string>, data?: unknown) =>
    readEmbeddedIdToken({ request: request(headers), data, appUrl: APP_URL, redirect });
  const bearer = { authorization: "Bearer the-token" };
  const serverFn = { "x-tsr-serverFn": "true" };

  it("takes the bearer before the data's id_token", () => {
    assert.strictEqual(embedded(bearer, { idToken: "data-token" }).idToken, "the-token");
    assert.strictEqual(embedded({}, { idToken: "data-token" }).idToken, "data-token");
  });

  it("a refused token: App Bridge's retry with a bearer, the ID token bounce for a document", () => {
    const refused = new InvalidIdTokenError({});
    const { rescueRefusal } = embedded({ ...bearer, ...serverFn });
    const retry = thrown(() => rescueRefusal(refused));
    assert.instanceOf(retry, Response);
    assert.strictEqual(
      retry instanceof Response ? retry.headers.get("X-Shopify-Retry-Invalid-Session-Request") : "",
      "1",
    );
    const bounce = thrown(() => embedded({}, { idToken: "data-token" }).rescueRefusal(refused));
    assert.deepStrictEqual(
      bounce,
      redirect({ href: idTokenBounce(APP_URL, "/app", `?shop=${SHOP}`) }),
    );
    const bare = thrown(() => embedded(serverFn));
    assert.strictEqual(bare instanceof Response ? bare.status : 0, 401);
  });

  it("an unsubscribed shop goes to plan selection, reloading the document", () => {
    const href = "/auth/exit-iframe?exitIframe=x";
    assert.deepStrictEqual(
      thrown(() => embedded(bearer).rescueRefusal(new PlanUnsubscribedError({ href }))),
      redirect({ href, reloadDocument: true }),
    );
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

  it("documentHeaders sends frame-ancestors only for a valid shop", () => {
    assert.deepStrictEqual(documentHeaders("not a shop"), {});
    assert.include(
      documentHeaders(SHOP)["Content-Security-Policy"],
      `frame-ancestors https://${SHOP}`,
    );
  });

  it("inlineScriptString cannot end its script: no `<` survives, and it reads back the same", () => {
    const value = `${APP_URL}/app?x=</script><script>alert(1)</script>`;
    const literal = inlineScriptString(value);
    assert.notInclude(literal, "<");
    assert.notInclude(literal.toLowerCase(), "</script");
    assert.strictEqual(JSON.parse(literal), value);
  });

  it("appSearch reads the text Shopify sent, plan_handle included", () => {
    assert.deepStrictEqual(appSearch(`?embedded=1&plan_handle=testbed-pro`), {
      embedded: "1",
      plan_handle: "testbed-pro",
    });
  });
});
