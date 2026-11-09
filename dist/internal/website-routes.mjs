import { APP_BRIDGE_URL, documentHeaders, exitIframeDestination, inlineScriptString } from "./shopify-urls.mjs";
import * as Option from "effect/Option";
// src/internal/website-routes.ts
/**
* The handlers of the server routes every embedded Website serves. Each app keeps its route file,
* because TanStack's router builds its tree from the app's `routes/` directory, and hands it the
* handlers here: `server: { handlers: sessionTokenHandlers(env) }`.
*
* @module
*/
const text = (status, body, headers) => new Response(body, {
	status,
	headers: {
		"content-type": "text/plain",
		...headers
	}
});
/**
* App Bridge and nothing else, plus `script` when given. On `/auth/session-token` App Bridge
* reads `shopify-reload` from the URL and reloads that page with a fresh `id_token`; with
* neither, it re-embeds a page the Shopify admin lost. Its headers are {@link documentHeaders}
* for `shop`.
*/
const appBridgePage = (apiKey, shop, script = "") => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="shopify-api-key" content="${apiKey}"><script src="${APP_BRIDGE_URL}"><\/script>${script}</head><body></body></html>`, { headers: {
	"content-type": "text/html;charset=utf-8",
	...documentHeaders(shop)
} });
/** `/auth/session-token`, the ID token bounce: the App Bridge-only page ({@link appBridgePage}). */
const sessionTokenHandlers = (env) => ({ GET: ({ request }) => appBridgePage(env.SHOPIFY_API_KEY, new URL(request.url).searchParams.get("shop")) });
/**
* `/auth/exit-iframe`: App Bridge, then the top window sent to `?exitIframe` (the app's URL when
* absent), for a destination the Shopify admin cannot frame, such as plan selection
* (`PlanUnsubscribedError`'s `href`). A destination {@link exitIframeDestination} refuses is
* `400`, so the route is never an open redirect.
*/
const exitIframeHandlers = (env) => ({ GET: ({ request }) => {
	const search = new URL(request.url).searchParams;
	return Option.match(exitIframeDestination(env.SHOPIFY_APP_URL, search.get("exitIframe") ?? env.SHOPIFY_APP_URL), {
		onNone: () => text(400, "Bad Request"),
		onSome: (destination) => appBridgePage(env.SHOPIFY_API_KEY, search.get("shop"), `<script>window.open(${inlineScriptString(destination.href)}, "_top")<\/script>`)
	});
} });
/**
* `/webhooks/*`: Shopify's webhooks forwarded to the Backend, which checks them. The request goes
* untouched: the HMAC is over the exact raw body, and it is the only credential, so there is no
* Origin check.
*/
const webhookHandlers = (env) => ({
	POST: ({ request }) => env.BACKEND.fetch(request),
	ANY: () => text(405, "Method Not Allowed", { allow: "POST" })
});
/**
* Whether an actor upgrade comes from another site: its `Origin` is present and is not the
* request's own. Browsers always send `Origin` on a WebSocket upgrade and a page cannot change it,
* so refusing these stops a page on another site from opening a socket with a token it got hold
* of; the socket's only legitimate opener is the App Home on this origin. A request with no
* `Origin` is not a browser's cross-site one, and the Backend's gate still decides who it is.
*/
const isCrossSiteUpgrade = (request) => {
	const origin = request.headers.get("origin");
	return origin !== null && origin !== new URL(request.url).origin;
};
/**
* `/api/actor/$key`: a WebSocket upgrade for one shop's actor, forwarded to the Backend, whose gate
* decides who may open it. Only the upgrade: the actor has no HTTP surface a browser can reach. An
* upgrade from another site ({@link isCrossSiteUpgrade}) is `403`.
*/
const actorUpgradeHandlers = (env) => ({ GET: ({ request }) => {
	if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return text(426, "Upgrade Required", { upgrade: "websocket" });
	if (isCrossSiteUpgrade(request)) return text(403, "Forbidden");
	return env.BACKEND.fetch(request);
} });
export { actorUpgradeHandlers, appBridgePage, exitIframeHandlers, isCrossSiteUpgrade, sessionTokenHandlers, webhookHandlers };
