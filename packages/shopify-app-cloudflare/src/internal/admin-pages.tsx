import {
  type AnyRouter,
  Outlet,
  useChildMatches,
  useLoaderData,
  useMatch,
  useParams,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useState } from "react";

import {
  type AdminShopData,
  type AdminShopRequest,
  AppInstallationsPageRequest,
  type CachedPlan,
} from "./admin-contract.ts";
import { Field, Fields, Instant } from "./admin-fields.tsx";
import {
  AdminLink,
  AdminLinkButton,
  type AdminMatch,
  REDIRECTED,
  routeOf,
  searchOrFirstPage,
  type ServerCall,
  STALE_RELOAD_MODE,
  useServerCall,
} from "./admin-section.tsx";
import type { AppInstallationRedactedPage } from "./app-installation.ts";
import { ShopDomain } from "./domain.ts";

function Presence({ present }: { readonly present: boolean }) {
  return (
    <s-badge tone={present ? "success" : "critical"}>{present ? "Present" : "Missing"}</s-badge>
  );
}

/** The `/admin/shops` route's options: the Shops page of the admin home. */
export const adminShops = {
  staticData: {
    admin: {
      title: "Shops",
      summary: "Each installed shop's installation, cached plan and access token.",
      order: 10,
    },
  },
};

function AdminShopsList() {
  const router: AnyRouter = useRouter();
  const page = useLoaderData({ strict: false }) as unknown as AppInstallationRedactedPage;
  const { filter } = useSearch({ strict: false }) as unknown as AppInstallationsPageRequest;
  const navigate = (search: AppInstallationsPageRequest) => {
    void router.navigate({ to: ".", search: () => search });
  };
  const search = (text: string) => {
    const next = text.trim();
    if (next === (filter ?? "")) return;
    navigate(next === "" ? {} : { filter: next });
  };
  return (
    <>
      <s-section padding="none" accessibilityLabel="Shops table">
        <s-table
          paginate={page.hasPreviousPage || page.hasNextPage}
          hasPreviousPage={page.hasPreviousPage}
          hasNextPage={page.hasNextPage}
          onPreviousPage={() => {
            if (page.startCursor !== null) navigate({ before: page.startCursor, filter });
          }}
          onNextPage={() => {
            if (page.endCursor !== null) navigate({ after: page.endCursor, filter });
          }}
        >
          <s-search-field
            key={filter}
            slot="filters"
            label="Search"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search by shop"
            value={filter ?? ""}
            onChange={(event) => {
              search(event.currentTarget.value);
            }}
          />
          <s-table-header-row>
            <s-table-header listSlot="primary">Shop</s-table-header>
            <s-table-header>Installed</s-table-header>
            <s-table-header>Scope</s-table-header>
            <s-table-header>Plan handle</s-table-header>
            <s-table-header>Plan fresh until</s-table-header>
            <s-table-header>Access token</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {page.appInstallations.map((row) => (
              <s-table-row key={row.shop} id={row.shop}>
                <s-table-cell>
                  <AdminLink to="/admin/shops/$shop" params={{ shop: row.shop }}>
                    {row.shop}
                  </AdminLink>
                </s-table-cell>
                <s-table-cell>
                  <Instant value={row.installedAt} />
                </s-table-cell>
                <s-table-cell>{row.scope ?? "—"}</s-table-cell>
                <s-table-cell>{row.planHandle ?? "—"}</s-table-cell>
                <s-table-cell>
                  <Instant value={row.planHandleExpiresAt} />
                </s-table-cell>
                <s-table-cell>
                  <Presence present={row.hasAccessToken} />
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      {page.appInstallations.length === 0 && <s-banner tone="info">No shops.</s-banner>}
    </>
  );
}

/**
 * The `/admin/shops/` route's options: every installed shop's `AppInstallation` row, tokens
 * redacted, a page at a time, searched by shop. `load` is the app's server function over
 * `appInstallationsPage`.
 */
export const adminShopsList = ({
  load,
}: {
  readonly load: ServerCall<AppInstallationsPageRequest, AppInstallationRedactedPage>;
}) => ({
  validateSearch: searchOrFirstPage(AppInstallationsPageRequest, {
    after: undefined,
    before: undefined,
    filter: undefined,
  }),
  loaderDeps: ({
    search: { after, before, filter },
  }: {
    readonly search: AppInstallationsPageRequest;
  }) => ({ after, before, filter }),
  loader: {
    handler: ({ deps }: { readonly deps: AppInstallationsPageRequest }) => load({ data: deps }),
    staleReloadMode: STALE_RELOAD_MODE,
  },
  component: AdminShopsList,
});

const decodeShopDomain = Schema.decodeUnknownOption(ShopDomain);

function AdminShop() {
  const router: AnyRouter = useRouter();
  const { routeId, params } = useMatch({ strict: false }) as unknown as AdminMatch;
  const active = (useChildMatches() as unknown as readonly AdminMatch[])[0]?.routeId;
  const tabs = (routeOf(router, routeId).children ?? [])
    .flatMap((route) => {
      const tab = route.options.staticData?.adminTab;
      return tab === undefined ? [] : [{ ...tab, route }];
    })
    .toSorted((a, b) => a.order - b.order);
  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" accessibilityLabel="Shop pages">
        {tabs.map(({ label, route }) => (
          <AdminLinkButton
            key={route.id}
            to={route.fullPath}
            params={params}
            variant={route.id === active ? "primary" : "secondary"}
          >
            {label}
          </AdminLinkButton>
        ))}
      </s-stack>
      <Outlet />
    </s-stack>
  );
}

/**
 * The `/admin/shops/$shop` route's options: the shop's domain as the heading, its tabs, and a
 * `$shop` that is not a shop domain failing as the page's error.
 */
export const adminShop = {
  staticData: { admin: { title: ({ shop }: Readonly<Record<string, string>>) => shop ?? "" } },
  params: {
    parse: ({ shop }: { readonly shop: string }) => ({
      shop: Option.getOrThrowWith(
        decodeShopDomain(shop),
        () => new Error(`${shop} is not a shop domain.`),
      ),
    }),
    stringify: ({ shop }: { readonly shop: ShopDomain }) => ({ shop }),
  },
  component: AdminShop,
};

const REFRESH_PLAN_FAILED = "Could not refresh the plan from Shopify.";

const planBadge = Match.typeTags<
  CachedPlan,
  { readonly tone: "success" | "warning" | "critical" | "neutral"; readonly label: string }
>()({
  Subscribed: () => ({ tone: "success", label: "Subscribed" }),
  Unsubscribed: () => ({ tone: "warning", label: "Unsubscribed" }),
  Stale: () => ({ tone: "neutral", label: "Stale" }),
  NeverFetched: () => ({ tone: "neutral", label: "Never fetched" }),
  Unrecognized: () => ({ tone: "critical", label: "Unrecognized" }),
});

const storedHandle = (plan: CachedPlan) => ("handle" in plan ? plan.handle : null);

type RefreshPlan = ServerCall<AdminShopRequest, string | null>;

function AdminShopOverview({ refreshPlan }: { readonly refreshPlan: RefreshPlan }) {
  const router: AnyRouter = useRouter();
  const data = useLoaderData({ strict: false }) as unknown as AdminShopData;
  const { shop } = useParams({ strict: false }) as unknown as AdminShopRequest;
  const refresh = useServerCall(refreshPlan);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  if (data._tag === "NotFound")
    return (
      <s-banner tone="warning" heading="Not installed">
        No app installation for this shop. Uninstall deletes it, so the app is not installed here.
      </s-banner>
    );
  const { appInstallation, plan, shopActorId } = data;
  const badge = planBadge(plan);
  const press = async () => {
    const failure = await refresh({ shop });
    if (failure === null) await router.invalidate({ sync: true });
    return failure === REDIRECTED ? null : failure;
  };
  return (
    <>
      {refreshError !== null && <s-banner tone="critical">{refreshError}</s-banner>}
      <s-section heading="Plan">
        <s-stack gap="base">
          <Fields>
            <Field label="Cached plan">
              <s-badge tone={badge.tone}>{badge.label}</s-badge>
            </Field>
            <Field label="Plan handle">{storedHandle(plan) ?? "—"}</Field>
            <Field label="Fresh until">
              <Instant value={appInstallation.planHandleExpiresAt} />
            </Field>
            <Field label="Plan boundary">
              <Instant value={appInstallation.planBoundaryAt} />
            </Field>
          </Fields>
          <s-stack gap="small-200">
            <s-box>
              <s-button
                variant="secondary"
                loading={refreshing}
                onClick={() => {
                  setRefreshError(null);
                  setRefreshing(true);
                  void press()
                    .then(setRefreshError, () => {
                      setRefreshError(REFRESH_PLAN_FAILED);
                    })
                    .finally(() => {
                      setRefreshing(false);
                    });
                }}
              >
                Refresh plan
              </s-button>
            </s-box>
            <s-paragraph color="subdued">
              Asks Shopify for the current app subscription and rewrites the cache. Use it when a
              merchant reports a subscription change that has not taken effect.
            </s-paragraph>
          </s-stack>
        </s-stack>
      </s-section>
      <s-section heading="Installation">
        <Fields>
          <Field label="Shop GID">{appInstallation.shopGid}</Field>
          <Field label="Installed">
            <Instant value={appInstallation.installedAt} />
          </Field>
          <Field label="Scope">{appInstallation.scope ?? "—"}</Field>
          <Field label="Access token">
            <Presence present={appInstallation.hasAccessToken} />
          </Field>
          <Field label="Access token expires">
            <Instant value={appInstallation.accessTokenExpiresAt} />
          </Field>
          <Field label="Shop Actor ID">{shopActorId}</Field>
        </Fields>
      </s-section>
    </>
  );
}

/**
 * The `/admin/shops/$shop/` route's options: the Overview tab, point in time, with the shop's
 * cached plan, Refresh plan and its installation. `load` is the app's server function over
 * `adminShop`, and `refreshPlan` its server function over `refreshPlan`.
 */
export const adminShopOverview = ({
  load,
  refreshPlan,
}: {
  readonly load: ServerCall<AdminShopRequest, AdminShopData>;
  readonly refreshPlan: RefreshPlan;
}) => ({
  staticData: { adminTab: { label: "Overview", order: 0 } },
  loader: {
    handler: ({ params: { shop } }: { readonly params: AdminShopRequest }) =>
      load({ data: { shop } }),
    staleReloadMode: STALE_RELOAD_MODE,
  },
  component: () => <AdminShopOverview refreshPlan={refreshPlan} />,
});
