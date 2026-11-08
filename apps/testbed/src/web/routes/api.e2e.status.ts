import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

/**
 * The e2e status route, forwarded untouched to the Backend. Only the `e2e` stage's Backend
 * (`src/e2e/worker.ts`) answers it; every other stage's answers `404`, so on dev, staging and
 * production the route does not exist.
 */
export const Route = createFileRoute("/api/e2e/status")({
  server: { handlers: { GET: ({ request }) => env.BACKEND.fetch(request) } },
});
