import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

export const Route = createFileRoute("/api/e2e/status")({
  server: { handlers: { GET: ({ request }) => env.BACKEND.fetch(request) } },
});
