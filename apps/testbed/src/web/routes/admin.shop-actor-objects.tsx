import { ShopActorObjectsPage } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute, type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { listShopActorObjects } from "#web/server/site.ts";

const ShopActorObjectsSearch = Schema.Struct({
  cursor: Schema.optional(Schema.NonEmptyString),
  page: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export const Route = createFileRoute("/admin/shop-actor-objects")({
  validateSearch: Schema.toStandardSchemaV1(ShopActorObjectsSearch),
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  loader: ({ deps }) => listShopActorObjects({ data: deps }),
  component: ShopActorObjectsRoute,
  errorComponent: ShopActorObjectsError,
});

function ShopActorObjectsError({ error }: ErrorComponentProps) {
  return (
    <s-page heading="Shop Actor Objects">
      <s-banner tone="critical" heading={error instanceof Error ? error.message : String(error)} />
    </s-page>
  );
}

function ShopActorObjectsRoute() {
  const router = useRouter();
  const { cursor, page = 0 } = Route.useSearch();
  return (
    <ShopActorObjectsPage
      data={Route.useLoaderData()}
      cursor={cursor}
      page={page}
      adminLink={{
        href: "/admin",
        onClick: () => {
          void router.navigate({ to: "/admin" });
        },
      }}
      onNavigate={(search) => {
        void router.navigate({ to: "/admin/shop-actor-objects", search });
      }}
    />
  );
}
