import { ShopDomain } from "@mw10013/shopify-app-cloudflare/contract";
import { AdminShopLayout } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

export const Route = createFileRoute("/admin/shop/$shop")({
  params: {
    parse: ({ shop }) => ({ shop: Schema.decodeUnknownSync(ShopDomain)(shop) }),
    stringify: ({ shop }) => ({ shop }),
  },
  component: ShopLayout,
});

function ShopLayout() {
  const router = useRouter();
  return (
    <AdminShopLayout
      shop={Route.useParams().shop}
      shopsLink={{
        href: "/admin/shops",
        onClick: () => {
          void router.navigate({ to: "/admin/shops" });
        },
      }}
    />
  );
}
