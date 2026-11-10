/**
 * The handlers of the server routes every embedded Website serves. Each app keeps its route file,
 * because TanStack's router builds its tree from the app's `routes/` directory, and hands it the
 * handlers here: `server: { handlers: sessionTokenHandlers(env) }`.
 *
 * @module
 */

import * as Option from "effect/Option";

import {
  APP_BRIDGE_URL,
  documentHeaders,
  exitIframeDestination,
  inlineScriptString,
} from "./shopify-urls.ts";
import { isAuthEndpoint } from "./site-auth-contract.ts";

/**
 * The Website's bindings the handlers read. Each handler reads them when it runs, so `env` may be
 * a proxy over `cloudflare:workers`'s `env`, which a top-level read breaks in TanStack Start dev.
 */
export interface WebsiteBindings {
  readonly SHOPIFY_API_KEY: string;
  readonly SHOPIFY_APP_URL: string;
  readonly BACKEND: { readonly fetch: (request: Request) => Promise<Response> };
}

const text = (status: number, body: string, headers?: Record<string, string>) =>
  new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });

/**
 * App Bridge and nothing else, plus `script` when given. On `/auth/session-token` App Bridge
 * reads `shopify-reload` from the URL and reloads that page with a fresh `id_token`; with
 * neither, it re-embeds a page the Shopify admin lost. Its headers are {@link documentHeaders}
 * for `shop`.
 */
export const appBridgePage = (apiKey: string, shop: unknown, script = ""): Response =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="shopify-api-key" content="${apiKey}"><script src="${APP_BRIDGE_URL}"></script>${script}</head><body></body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8", ...documentHeaders(shop) } },
  );

/** `/auth/session-token`, the ID token bounce: the App Bridge-only page ({@link appBridgePage}). */
export const sessionTokenHandlers = (env: Pick<WebsiteBindings, "SHOPIFY_API_KEY">) => ({
  GET: ({ request }: { readonly request: Request }) =>
    appBridgePage(env.SHOPIFY_API_KEY, new URL(request.url).searchParams.get("shop")),
});

/**
 * `/auth/exit-iframe`: App Bridge, then the top window sent to `?exitIframe` (the app's URL when
 * absent), for a destination the Shopify admin cannot frame, such as plan selection
 * (`PlanUnsubscribedError`'s `href`). A destination {@link exitIframeDestination} refuses is
 * `400`, so the route is never an open redirect.
 */
export const exitIframeHandlers = (
  env: Pick<WebsiteBindings, "SHOPIFY_API_KEY" | "SHOPIFY_APP_URL">,
) => ({
  GET: ({ request }: { readonly request: Request }) => {
    const search = new URL(request.url).searchParams;
    return Option.match(
      exitIframeDestination(env.SHOPIFY_APP_URL, search.get("exitIframe") ?? env.SHOPIFY_APP_URL),
      {
        onNone: () => text(400, "Bad Request"),
        onSome: (destination) =>
          appBridgePage(
            env.SHOPIFY_API_KEY,
            search.get("shop"),
            `<script>window.open(${inlineScriptString(destination.href)}, "_top")</script>`,
          ),
      },
    );
  },
});

/**
 * `/webhooks/*`: Shopify's webhooks forwarded to the Backend, which checks them. The request goes
 * untouched: the HMAC is over the exact raw body, and it is the only credential, so there is no
 * Origin check.
 */
export const webhookHandlers = (env: Pick<WebsiteBindings, "BACKEND">) => ({
  POST: ({ request }: { readonly request: Request }) => env.BACKEND.fetch(request),
  ANY: () => text(405, "Method Not Allowed", { allow: "POST" }),
});

/**
 * Whether an actor upgrade comes from another site: its `Origin` is present and is not the
 * request's own. Browsers always send `Origin` on a WebSocket upgrade and a page cannot change it,
 * so refusing these stops a page on another site from opening a socket with a token it got hold
 * of; the socket's only legitimate opener is the App Home on this origin. A request with no
 * `Origin` is not a browser's cross-site one, and the Backend's gate still decides who it is.
 */
export const isCrossSiteUpgrade = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
};

/**
 * `/api/actor/$key`: a WebSocket upgrade for one shop's actor, forwarded to the Backend, whose gate
 * decides who may open it. Only the upgrade: the actor has no HTTP surface a browser can reach. An
 * upgrade from another site ({@link isCrossSiteUpgrade}) is `403`.
 */
export const actorUpgradeHandlers = (env: Pick<WebsiteBindings, "BACKEND">) => ({
  GET: ({ request }: { readonly request: Request }) => {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return text(426, "Upgrade Required", { upgrade: "websocket" });
    if (isCrossSiteUpgrade(request)) return text(403, "Forbidden");
    return env.BACKEND.fetch(request);
  },
});

/**
 * `/api/auth/$`: the Better Auth endpoints a browser may reach (`AUTH_ENDPOINTS`) forwarded to the
 * Backend, every other path `404`. The answer sets or clears the session cookie, so it passes
 * through to the browser unfollowed. The Backend refuses any other endpoint itself as well.
 */
export const authHandlers = (env: Pick<WebsiteBindings, "BACKEND">) => {
  const forward = ({ request }: { readonly request: Request }) =>
    isAuthEndpoint(request.method, new URL(request.url).pathname)
      ? env.BACKEND.fetch(new Request(request, { redirect: "manual" }))
      : Promise.resolve(text(404, "Not Found"));
  return { GET: forward, POST: forward };
};
