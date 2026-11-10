import { sessionTokenHandlers } from "@mw10013/shopify-app-cloudflare/website";
import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

export const Route = createFileRoute("/auth/session-token")({
  server: { handlers: sessionTokenHandlers(env) },
});
