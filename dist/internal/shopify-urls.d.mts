import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
/** App Bridge, which the Shopify admin requires as the App Home document's first script. */
export declare const APP_BRIDGE_URL = "https://cdn.shopify.com/shopifycloud/app-bridge.js";
/**
 * Polaris web components, pinned to the 2.0 line with `@shopify/polaris-types` at the matching
 * `2.0.*`: Shopify publishes each minor line at its own URL.
 */
export declare const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris-2.0.js";
/**
 * The app inside the Shopify admin, `https://<admin>/apps/<apiKey>`, where `host` names the
 * Shopify admin (the library's `auth.getEmbeddedAppUrl` builds the same). None when `host` names
 * no Shopify admin.
 */
export declare const embeddedAppUrl: (host: string, apiKey: string) => Option.Option<string>;
/**
 * The ID token bounce for a document: `/auth/session-token` with the request's search minus
 * `id_token`, plus `shopify-reload`, the page App Bridge reloads with a fresh token. `appUrl` is
 * the app's public URL from the binding, because behind the dev proxies the request's own URL is
 * not the one the Shopify admin loaded.
 */
export declare const idTokenBounce: (appUrl: string, path: string, search: string) => string;
/** See {@link ExitIframeDestination}. */
export declare const exitIframeDestination: (appUrl: string, candidate: string) => Option.Option<URL>;
/**
 * The headers of a document the Shopify admin frames, as `@shopify/shopify-app-react-router`'s
 * `addDocumentResponseHeaders` sends them for an embedded app. Empty unless `shop` is a
 * {@link ShopDomain}: a page without one sends no `frame-ancestors`, so any site may frame it, as
 * the library leaves it. `frame-ancestors 'none'` would break the ID token bounce, which the
 * Shopify admin frames for a request that lost its `shop`.
 */
export declare const documentHeaders: (shop: unknown) => Record<string, string>;
/**
 * What Shopify puts on the App Home's URL, read from the raw search string. The router parses
 * each search value as JSON (`embedded=1` becomes the number `1`), so the guard reads the text
 * Shopify sent.
 */
declare const AppSearch: Schema.Struct<{
  readonly shop: Schema.optional<Schema.String>;
  readonly host: Schema.optional<Schema.String>;
  readonly embedded: Schema.optional<Schema.String>;
  readonly id_token: Schema.optional<Schema.String>;
  readonly plan_handle: Schema.optional<Schema.String>;
}>;
type AppSearch = typeof AppSearch.Type;
/** {@link AppSearch} from a location's `searchStr`; anything that does not decode is empty. */
export declare const appSearch: (searchStr: string) => AppSearch;
export { AppSearch };