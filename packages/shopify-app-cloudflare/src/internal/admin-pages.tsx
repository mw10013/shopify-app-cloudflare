/**
 * The common admin pages: the Shops list, the shop layout whose tabs are its child routes, and the
 * shop's Overview. They hold no server call: an app's route loads the data and passes callbacks.
 *
 * @module
 */

import {
  type AnyRouter,
  Outlet,
  useChildMatches,
  useMatch,
  useRouter,
} from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import { type ReactNode, useState } from "react";

import type {
  AdminShopData,
  AppInstallationsPageRequest,
  CachedPlan,
  ShopSearch,
} from "./admin-contract.ts";
import { Breadcrumb, linkProps, type PageLink } from "./admin-link.tsx";
import type { AppInstallationRedactedPage } from "./app-installation.ts";
import type { ShopDomain } from "./domain.ts";

/** A child route of {@link AdminShopLayout} shown as a tab: its label, and its place by `order`. */
export interface AdminTab {
  readonly label: string;
  readonly order: number;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Shows this child of `AdminShopLayout`'s route as a tab. Absent: no tab. */
    readonly adminTab?: AdminTab;
  }
}

/** An instant as UTC ISO text, the same on the server and in the browser. */
function Instant({ value }: { readonly value: DateTime.Utc | null }) {
  return value === null ? "—" : DateTime.formatIso(value);
}

function Presence({ present }: { readonly present: boolean }) {
  return (
    <s-badge tone={present ? "success" : "critical"}>{present ? "Present" : "Missing"}</s-badge>
  );
}

export interface AdminShopsPageProps {
  readonly page: AppInstallationRedactedPage;
  /** The search `page` was read with. */
  readonly filter: ShopSearch | undefined;
  /** The breadcrumb to the admin's index. */
  readonly adminLink: PageLink;
  readonly shopLink: (shop: ShopDomain) => PageLink;
  /** Takes the app's route to `search`: the next or previous page, or a new search. */
  readonly onNavigate: (search: AppInstallationsPageRequest) => void;
  /** The app's own page actions, such as its sign-out button, slotted into the page. */
  readonly children?: ReactNode;
}

/** Every installed shop's `AppInstallation` row, tokens redacted, a page at a time, searched by shop. */
export function AdminShopsPage(props: AdminShopsPageProps) {
  const { page, filter } = props;
  const search = (text: string) => {
    const next = text.trim();
    if (next === (filter ?? "")) return;
    props.onNavigate(next === "" ? {} : { filter: next });
  };
  return (
    <s-page heading="Shops" inlineSize="large">
      <Breadcrumb link={props.adminLink} label="Admin" />
      {props.children}
      <s-section padding="none" accessibilityLabel="Shops table">
        <s-table
          paginate={page.hasPreviousPage || page.hasNextPage}
          hasPreviousPage={page.hasPreviousPage}
          hasNextPage={page.hasNextPage}
          onPreviousPage={() => {
            if (page.startCursor !== null) props.onNavigate({ before: page.startCursor, filter });
          }}
          onNextPage={() => {
            if (page.endCursor !== null) props.onNavigate({ after: page.endCursor, filter });
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
                  <s-link {...linkProps(props.shopLink(row.shop))}>{row.shop}</s-link>
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
    </s-page>
  );
}

export interface AdminShopLayoutProps {
  readonly shop: ShopDomain;
  /** The breadcrumb to the Shops list. */
  readonly shopsLink: PageLink;
  /** The app's own page actions, such as its sign-out button, slotted into the page. */
  readonly children?: ReactNode;
}

/**
 * What the layout reads of a match. A match is `any` in the package and the app's own route union
 * in an app, so the layout reads it through `unknown` to check alike in both.
 */
interface Match {
  readonly routeId: string;
  readonly params: Readonly<Record<string, string>>;
}

/** What the layout reads of a child route; TanStack leaves a route's `children` untyped. */
interface ChildRoute {
  readonly id: string;
  readonly fullPath: string;
  readonly options: { readonly staticData?: { readonly adminTab?: AdminTab } };
}

/**
 * The layout of the app's `/admin/shop/$shop` route: the shop's page, a tab for each child route
 * whose `staticData.adminTab` is set, in `order`, and the child's page beneath them. An app adds a
 * tab by adding a child route; the layout lists none itself.
 */
export function AdminShopLayout(props: AdminShopLayoutProps) {
  const router: AnyRouter = useRouter();
  const { routeId, params } = useMatch({ strict: false }) as unknown as Match;
  const active = (useChildMatches() as unknown as readonly Match[])[0]?.routeId;
  const children = (router.routesById[routeId] as { readonly children?: readonly ChildRoute[] })
    .children;
  const tabs = (children ?? [])
    .flatMap((route) => {
      const tab = route.options.staticData?.adminTab;
      return tab === undefined ? [] : [{ ...tab, route }];
    })
    .toSorted((a, b) => a.order - b.order);
  return (
    <s-page heading={props.shop} inlineSize="large">
      <Breadcrumb link={props.shopsLink} label="Shops" />
      {props.children}
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" accessibilityLabel="Shop pages">
          {tabs.map(({ label, route }) => (
            <s-button
              key={route.id}
              variant={route.id === active ? "primary" : "secondary"}
              {...linkProps({
                href: router.buildLocation({ to: route.fullPath, params }).href,
                onClick: () => {
                  void router.navigate({ to: route.fullPath, params });
                },
              })}
            >
              {label}
            </s-button>
          ))}
        </s-stack>
        <Outlet />
      </s-stack>
    </s-page>
  );
}

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

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <s-stack gap="small-300">
      <s-text color="subdued">{label}</s-text>
      {children}
    </s-stack>
  );
}

function Fields({ children }: { readonly children: ReactNode }) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
      {children}
    </s-grid>
  );
}

export interface AdminShopOverviewPageProps {
  readonly data: AdminShopData;
  /**
   * Refresh plan's press: the app's server function, then its loader read again. Answers `null`
   * once the new plan is shown, else the banner's sentence.
   */
  readonly onRefreshPlan: () => Promise<string | null>;
}

/**
 * The shop's Overview tab, point in time: its cached plan with Refresh plan, and its installation.
 * Rendered inside {@link AdminShopLayout}, so it is sections, not a page.
 */
export function AdminShopOverviewPage({ data, onRefreshPlan }: AdminShopOverviewPageProps) {
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
  const refresh = () => {
    setRefreshError(null);
    setRefreshing(true);
    void onRefreshPlan()
      .then(setRefreshError, () => {
        setRefreshError(REFRESH_PLAN_FAILED);
      })
      .finally(() => {
        setRefreshing(false);
      });
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
              <s-button variant="secondary" loading={refreshing} onClick={refresh}>
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
