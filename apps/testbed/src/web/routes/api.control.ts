import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

export const Route = createFileRoute("/api/control")({
  server: { handlers: { POST: ({ request }) => env.BACKEND.fetch(request) } },
});
