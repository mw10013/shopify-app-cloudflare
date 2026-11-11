import { adminShopsList } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute } from "@tanstack/react-router";

import { listAppInstallations } from "#web/server/site.ts";

export const Route = createFileRoute("/admin/shops/")(
  adminShopsList({ load: listAppInstallations }),
);
