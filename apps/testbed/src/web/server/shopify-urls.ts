/**
 * The embedded App Home's redirects, page destinations and document headers, as pure functions
 * over the request's search, so the guard and the auth routes share them and unit tests reach
 * them without the Website's bindings. Ported from baton's `src/web/server/shopify-urls.ts`.
 *
 * @module
 */

import { ShopDomain } from "@mw10013/shopify-app-workers/contract";
import { APP_BRIDGE_URL, POLARIS_URL } from "@mw10013/shopify-app-workers/website";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** Shopify's CDN, which App Bridge and Polaris load from. */
const CDN_URL = "https://cdn.shopify.com";

/**
 * Base64 with its padding optional: Shopify's `host` param usually arrives without it, and
 * `Schema.StringFromBase64` requires it.
 */
const UnpaddedBase64 = Schema.String.pipe(
  Schema.decodeTo(
    Schema.StringFromBase64,
    SchemaTransformation.transform({
      decode: (text) => text.padEnd(Math.ceil(text.length / 4) * 4, "="),
      encode: (text) => text,
    }),
  ),
);

/**
 * Shopify's `host` search param: base64 of the Shopify admin the app is embedded in,
 * `admin.shopify.com/store/<store>`, or the legacy `<shop>.myshopify.com/admin`.
 */
const ShopifyAdminHost = UnpaddedBase64.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isPattern(
        /^(?:admin\.shopify\.com\/store\/[a-zA-Z0-9][a-zA-Z0-9_-]*|[a-z0-9][a-z0-9-]*\.myshopify\.com\/admin)$/u,
      ),
    ),
  ),
);
const decodeShopifyAdminHost = Schema.decodeUnknownOption(ShopifyAdminHost);

/**
 * The app inside the Shopify admin, `https://<admin>/apps/<apiKey>`, where `host` names the
 * Shopify admin (the library's `auth.getEmbeddedAppUrl` builds the same). None when `host` names
 * no Shopify admin.
 */
export const embeddedAppUrl = (host: string, apiKey: string): Option.Option<string> =>
  Option.map(
    decodeShopifyAdminHost(host),
    (shopifyAdmin) => `https://${shopifyAdmin}/apps/${apiKey}`,
  );

/**
 * The ID token bounce for a document: `/auth/session-token` with the request's search minus
 * `id_token`, plus `shopify-reload`, the page App Bridge reloads with a fresh token. `appUrl` is
 * the app's public URL from the binding, because behind the dev proxies the request's own URL is
 * not the one the Shopify admin loaded.
 */
export const idTokenBounce = (appUrl: string, path: string, search: string): string => {
  const params = new URLSearchParams(search);
  params.delete("id_token");
  params.set("shopify-reload", `${appUrl}${path}?${params.toString()}`);
  return `/auth/session-token?${params.toString()}`;
};

/** The Shopify admin's App Pricing page, the one off-origin destination: plan selection. */
const PricingPlansPath = Schema.String.check(
  Schema.isPattern(
    /^\/store\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/charges\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/pricing_plans$/u,
  ),
);
const isPricingPlansPath = Schema.is(PricingPlansPath);

/**
 * Where `/auth/exit-iframe` may send the top window: a URL on the app's own origin, or the
 * Shopify admin's App Pricing page with no search or hash. Credentials are refused, so the
 * rendered URL cannot disguise another authority. Relative candidates resolve against `appUrl`.
 */
const ExitIframeDestination = (appUrl: string) =>
  Schema.String.pipe(
    Schema.decodeTo(
      Schema.URL,
      SchemaTransformation.transformEffect({
        decode: (candidate, options) =>
          URL.canParse(candidate, appUrl)
            ? Effect.succeed(new URL(candidate, appUrl))
            : Effect.fail(new SchemaIssue.InvalidValue({ expected: "a URL" }, candidate, options)),
        encode: (url) => Effect.succeed(url.href),
      }),
    ),
    Schema.check(
      Schema.makeFilter(
        (url: URL) =>
          url.username === "" &&
          url.password === "" &&
          (url.origin === new URL(appUrl).origin ||
            (url.origin === "https://admin.shopify.com" &&
              isPricingPlansPath(url.pathname) &&
              url.search === "" &&
              url.hash === "")),
        { expected: "the app's origin or the Shopify admin's pricing plans page" },
      ),
    ),
  );

/** See {@link ExitIframeDestination}. */
export const exitIframeDestination = (appUrl: string, candidate: string): Option.Option<URL> =>
  Schema.decodeUnknownOption(ExitIframeDestination(appUrl))(candidate);

const decodeShop = Schema.decodeUnknownOption(ShopDomain);

/**
 * The headers of a document the Shopify admin frames, as `@shopify/shopify-app-react-router`'s
 * `addDocumentResponseHeaders` sends them for an embedded app. Empty unless `shop` is a
 * {@link ShopDomain}: a page without one sends no `frame-ancestors`, so any site may frame it, as
 * the library leaves it. `frame-ancestors 'none'` would break the ID token bounce, which the
 * Shopify admin frames for a request that lost its `shop`.
 */
export const documentHeaders = (shop: unknown): Record<string, string> =>
  Option.match(decodeShop(shop), {
    onNone: () => ({}),
    onSome: (key) => ({
      "Content-Security-Policy": `frame-ancestors https://${key} https://admin.shopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev;`,
      Link: `<${CDN_URL}>; rel="preconnect", <${APP_BRIDGE_URL}>; rel="preload"; as="script", <${POLARIS_URL}>; rel="preload"; as="script"`,
    }),
  });

/**
 * What Shopify puts on the App Home's URL, read from the raw search string. The router parses
 * each search value as JSON (`embedded=1` becomes the number `1`), so the guard reads the text
 * Shopify sent.
 */
const AppSearch = Schema.Struct({
  shop: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  embedded: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
  plan_handle: Schema.optional(Schema.String),
});
export type AppSearch = typeof AppSearch.Type;
const decodeSearch = Schema.decodeUnknownOption(AppSearch);

/** {@link AppSearch} from a location's `searchStr`; anything that does not decode is empty. */
export const appSearch = (searchStr: string): AppSearch =>
  Option.getOrElse(decodeSearch(Object.fromEntries(new URLSearchParams(searchStr))), () => ({}));

/**
 * A string for a classic inline script: JSON with `<` escaped as `\u003c`, because the HTML
 * parser ends the script at `</script>` before JavaScript sees the quotes.
 */
export const inlineScriptString = (value: string): string =>
  JSON.stringify(value).replaceAll("<", String.raw`\u003c`);
