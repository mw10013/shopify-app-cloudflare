import { exitIframeHandlers } from "@mw10013/shopify-app-workers/website";
import { createFileRoute } from "@tanstack/react-router";

import { env } from "#web/server/env.server.ts";

export const Route = createFileRoute("/auth/exit-iframe")({
  server: { handlers: exitIframeHandlers(env) },
});
