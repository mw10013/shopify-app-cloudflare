/**
 * The App Bridge-only document the two auth routes serve. Its own module, apart from the
 * middleware and server functions: it reads the Website's bindings in plain code, which only a
 * server route may import.
 *
 * @module
 */

import { APP_BRIDGE_URL } from "@mw10013/shopify-app-workers/website";

import { env } from "./env.server.ts";
import { documentHeaders } from "./shopify-urls.ts";

/**
 * App Bridge and nothing else, plus `script` when given. On `/auth/session-token` App Bridge
 * reads `shopify-reload` from the URL and reloads that page with a fresh `id_token`; with
 * neither, it re-embeds a page the Shopify admin lost. Its headers are {@link documentHeaders}
 * for `shop`.
 */
export const appBridgePage = (shop: unknown, script = ""): Response =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="shopify-api-key" content="${env.SHOPIFY_API_KEY}"><script src="${APP_BRIDGE_URL}"></script>${script}</head><body></body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8", ...documentHeaders(shop) } },
  );
