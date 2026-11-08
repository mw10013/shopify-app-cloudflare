import { env } from "./env.server.ts";

/**
 * The `/webhooks/*` route's handlers: Shopify's webhooks forwarded to the Backend, which checks
 * them. The request goes untouched: the HMAC is over the exact raw body, and it is the only
 * credential, so there is no Origin check. Apart from the route, so the integ suite's test
 * Website serves the same handlers.
 */
export const webhookHandlers = {
  POST: ({ request }: { readonly request: Request }) => env.BACKEND.fetch(request),
  ANY: () =>
    new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST", "content-type": "text/plain" },
    }),
};
