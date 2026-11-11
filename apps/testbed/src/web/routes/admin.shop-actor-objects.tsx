import { adminShopActorObjects } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute } from "@tanstack/react-router";

import { listShopActorObjects } from "#web/server/site.ts";

export const Route = createFileRoute("/admin/shop-actor-objects")(
  adminShopActorObjects({ load: listShopActorObjects }),
);
