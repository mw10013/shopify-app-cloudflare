import { adminOrphanShopActorObjects } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute } from "@tanstack/react-router";

import { destroyOrphan, listOrphanShopActorObjects } from "#web/server/site.ts";

export const Route = createFileRoute("/admin/orphan-shop-actor-objects")(
  adminOrphanShopActorObjects({ load: listOrphanShopActorObjects, destroy: destroyOrphan }),
);
