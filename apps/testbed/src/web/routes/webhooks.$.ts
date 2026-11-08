import { createFileRoute } from "@tanstack/react-router";

import { webhookHandlers } from "#web/server/webhooks.ts";

/** Shopify's webhooks, forwarded to the Backend ({@link webhookHandlers}). */
export const Route = createFileRoute("/webhooks/$")({
  server: { handlers: webhookHandlers },
});
