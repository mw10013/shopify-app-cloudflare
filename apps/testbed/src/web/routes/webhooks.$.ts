import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

/**
 * Forwards Shopify's webhooks to the Backend, which checks them. The request goes untouched: the
 * HMAC is over the exact raw body, and it is the only credential, so there is no Origin check.
 */
export const Route = createFileRoute("/webhooks/$")({
  server: {
    handlers: {
      POST: ({ request }) => env.BACKEND.fetch(request),
      ANY: () =>
        new Response("Method Not Allowed", {
          status: 405,
          headers: { allow: "POST", "content-type": "text/plain" },
        }),
    },
  },
});
