import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

const text = (status: number, body: string, headers?: Record<string, string>) =>
  new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });

/**
 * Forwards a WebSocket upgrade for one shop's actor to the Backend, whose gate decides who may
 * open it. An upgrade whose `Origin` is another site's is refused with 403: browsers always send
 * `Origin` on an upgrade, and the socket's only legitimate opener is the App Home on this origin.
 */
export const Route = createFileRoute("/api/actor/$key")({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
          return text(426, "Upgrade Required", { upgrade: "websocket" });
        const origin = request.headers.get("origin");
        if (origin !== null && origin !== new URL(request.url).origin)
          return text(403, "Forbidden");
        return env.BACKEND.fetch(request);
      },
    },
  },
});
