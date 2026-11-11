import { AdminShopOverviewPage } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { getAdminShop, refreshPlan } from "#web/server/site.ts";

/**
 * `staleReloadMode: "blocking"`: a revisit waits for a fresh reading instead of painting the last
 * one, since an admin comes back to check whether something just changed.
 */
export const Route = createFileRoute("/admin/shop/$shop/")({
  staticData: { adminTab: { label: "Overview", order: 0 } },
  loader: {
    handler: ({ params }) => getAdminShop({ data: { shop: params.shop } }),
    staleReloadMode: "blocking",
  },
  component: OverviewRoute,
});

function OverviewRoute() {
  const router = useRouter();
  const refresh = useServerFn(refreshPlan);
  const { shop } = Route.useParams();
  return (
    <AdminShopOverviewPage
      data={Route.useLoaderData()}
      onRefreshPlan={async () => {
        const failure = await refresh({ data: { shop } });
        // useServerFn resolves `undefined` once it has followed a redirect; its type omits it.
        if (failure === undefined) return null;
        if (failure !== null) return failure;
        await router.invalidate({ sync: true });
        return null;
      }}
    />
  );
}
