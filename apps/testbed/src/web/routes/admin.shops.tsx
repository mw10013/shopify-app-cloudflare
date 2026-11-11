import { adminShops } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/shops")(adminShops);
