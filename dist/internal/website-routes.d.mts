/**
 * The handlers of the server routes every embedded Website serves. Each app keeps its route file,
 * because TanStack's router builds its tree from the app's `routes/` directory, and hands it the
 * handlers here: `server: { handlers: sessionTokenHandlers(env) }`.
 *
 * @module
 */
/**
 * The Website's bindings the handlers read. Each handler reads them when it runs, so `env` may be
 * a proxy over `cloudflare:workers`'s `env`, which a top-level read breaks in TanStack Start dev.
 */
export interface WebsiteBindings {
  readonly SHOPIFY_API_KEY: string;
  readonly SHOPIFY_APP_URL: string;
  readonly BACKEND: {
    readonly fetch: (request: Request) => Promise<Response>;
  };
}
/**
 * App Bridge and nothing else, plus `script` when given. On `/auth/session-token` App Bridge
 * reads `shopify-reload` from the URL and reloads that page with a fresh `id_token`; with
 * neither, it re-embeds a page the Shopify admin lost. Its headers are {@link documentHeaders}
 * for `shop`.
 */
export declare const appBridgePage: (apiKey: string, shop: unknown, script?: string) => Response;
/** `/auth/session-token`, the ID token bounce: the App Bridge-only page ({@link appBridgePage}). */
export declare const sessionTokenHandlers: (env: Pick<WebsiteBindings, "SHOPIFY_API_KEY">) => {
  GET: ({ request }: {
    readonly request: Request;
  }) => Response;
};
/**
 * `/auth/exit-iframe`: App Bridge, then the top window sent to `?exitIframe` (the app's URL when
 * absent), for a destination the Shopify admin cannot frame, such as plan selection
 * (`PlanUnsubscribedError`'s `href`). A destination {@link exitIframeDestination} refuses is
 * `400`, so the route is never an open redirect.
 */
export declare const exitIframeHandlers: (env: Pick<WebsiteBindings, "SHOPIFY_API_KEY" | "SHOPIFY_APP_URL">) => {
  GET: ({ request }: {
    readonly request: Request;
  }) => Response;
};
/**
 * `/webhooks/*`: Shopify's webhooks forwarded to the Backend, which checks them. The request goes
 * untouched: the HMAC is over the exact raw body, and it is the only credential, so there is no
 * Origin check.
 */
export declare const webhookHandlers: (env: Pick<WebsiteBindings, "BACKEND">) => {
  POST: ({ request }: {
    readonly request: Request;
  }) => Promise<Response>;
  ANY: () => Response;
};
/**
 * Whether an actor upgrade comes from another site: its `Origin` is present and is not the
 * request's own. Browsers always send `Origin` on a WebSocket upgrade and a page cannot change it,
 * so refusing these stops a page on another site from opening a socket with a token it got hold
 * of; the socket's only legitimate opener is the App Home on this origin. A request with no
 * `Origin` is not a browser's cross-site one, and the Backend's gate still decides who it is.
 */
export declare const isCrossSiteUpgrade: (request: Request) => boolean;
/**
 * `/api/actor/$key`: a WebSocket upgrade for one shop's actor, forwarded to the Backend, whose gate
 * decides who may open it. Only the upgrade: the actor has no HTTP surface a browser can reach. An
 * upgrade from another site ({@link isCrossSiteUpgrade}) is `403`.
 */
export declare const actorUpgradeHandlers: (env: Pick<WebsiteBindings, "BACKEND">) => {
  GET: ({ request }: {
    readonly request: Request;
  }) => Promise<Response> | Response;
};