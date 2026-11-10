import { OrphanShopActorObjectsPage } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute, type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

import { destroyOrphan, listOrphanShopActorObjects } from "#web/server/site.ts";

const OrphanShopActorObjectsSearch = Schema.Struct({
  cursor: Schema.optional(Schema.NonEmptyString),
});

export const Route = createFileRoute("/admin/orphan-shop-actor-objects")({
  validateSearch: Schema.toStandardSchemaV1(OrphanShopActorObjectsSearch),
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  loader: ({ deps }) => listOrphanShopActorObjects({ data: deps }),
  component: OrphanShopActorObjectsRoute,
  errorComponent: OrphanShopActorObjectsError,
});

function OrphanShopActorObjectsError({ error }: ErrorComponentProps) {
  return (
    <s-page heading="Orphan Shop Actor Objects">
      <s-banner tone="critical" heading={error instanceof Error ? error.message : String(error)} />
    </s-page>
  );
}

function OrphanShopActorObjectsRoute() {
  const router = useRouter();
  const destroy = useServerFn(destroyOrphan);
  const { cursor } = Route.useSearch();
  return (
    <OrphanShopActorObjectsPage
      data={Route.useLoaderData()}
      cursor={cursor}
      adminLink={{
        onClick: () => {
          void router.navigate({ to: "/admin" });
        },
      }}
      onNavigate={(next) => {
        void router.navigate({
          to: "/admin/orphan-shop-actor-objects",
          search: next === undefined ? {} : { cursor: next },
        });
      }}
      onDestroy={async (id) => {
        const failure = await destroy({ data: { id } });
        // useServerFn resolves `undefined` once it has followed a redirect; its type omits it.
        if (failure === undefined) return "Redirected";
        await router.invalidate({ sync: true });
        return failure === null ? "Destroyed" : "InstalledAgain";
      }}
    />
  );
}
