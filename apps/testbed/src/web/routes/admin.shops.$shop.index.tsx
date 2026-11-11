import { adminShopOverview } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute } from "@tanstack/react-router";

import { getAdminShop, refreshPlan } from "#web/server/site.ts";

export const Route = createFileRoute("/admin/shops/$shop/")(
  adminShopOverview({ load: getAdminShop, refreshPlan }),
);
