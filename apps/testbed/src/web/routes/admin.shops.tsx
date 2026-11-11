import { AppInstallationsPageRequest } from "@mw10013/shopify-app-cloudflare/contract";
import { AdminShopsPage } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { listAppInstallations } from "#web/server/site.ts";

export const Route = createFileRoute("/admin/shops")({
  validateSearch: Schema.toStandardSchemaV1(AppInstallationsPageRequest),
  loaderDeps: ({ search: { after, before, filter } }) => ({ after, before, filter }),
  loader: ({ deps }) => listAppInstallations({ data: deps }),
  component: ShopsRoute,
});

function ShopsRoute() {
  const router = useRouter();
  return (
    <AdminShopsPage
      page={Route.useLoaderData()}
      filter={Route.useSearch().filter}
      adminLink={{
        href: "/admin",
        onClick: () => {
          void router.navigate({ to: "/admin" });
        },
      }}
      shopLink={(shop) => ({
        href: `/admin/shop/${shop}`,
        onClick: () => {
          void router.navigate({ to: "/admin/shop/$shop", params: { shop } });
        },
      })}
      onNavigate={(search) => {
        void router.navigate({ to: "/admin/shops", search });
      }}
    />
  );
}
