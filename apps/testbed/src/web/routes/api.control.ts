import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

/**
 * The control door, forwarded untouched to the Backend, which decides who may call it: anyone on
 * the disposable stages, a bearer of the stage's token on staging, and no one on production.
 */
export const Route = createFileRoute("/api/control")({
  server: { handlers: { POST: ({ request }) => env.BACKEND.fetch(request) } },
});
