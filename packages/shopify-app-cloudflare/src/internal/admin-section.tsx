/**
 * The admin section's frame, built from the app's route tree: the `/admin` layout's one page with
 * its heading, breadcrumb, Sign out and error banner, and the home page that lists the section's
 * pages. A route joins the section by declaring `staticData.admin`.
 *
 * @module
 */

import {
  type AnyRouter,
  createLink,
  type ErrorComponentProps,
  isRedirect,
  Outlet,
  useMatch,
  useMatches,
  useRouter,
} from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ComponentProps, ReactNode } from "react";

import { SignOutButton } from "./site-sign-in.tsx";

/**
 * A route's place in the admin section: its heading, and the page its breadcrumb returns to. A
 * child of `/admin` with a `summary` is listed on the home page, in `order` (unordered last). A
 * route whose title reads its params has no summary, since the home page has no params to give.
 */
export type AdminPage =
  | { readonly title: string; readonly summary?: string; readonly order?: number }
  | { readonly title: (params: Readonly<Record<string, string>>) => string };

/** A child route of the shop page shown as a tab: its label, and its place by `order`. */
export interface AdminTab {
  readonly label: string;
  readonly order: number;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Makes the route a page of the admin section. Absent: it renders under its parent's heading. */
    readonly admin?: AdminPage;
    /** Shows this child of the shop page as a tab. Absent: no tab. */
    readonly adminTab?: AdminTab;
  }
}

const ADMIN_SIGN_IN_PATH = "/admin/sign-in";

/**
 * What the section reads of a match and a route. Each is `any` in the package and the app's own
 * union in an app, so the section reads them through `unknown` to check alike in both.
 */
export interface AdminMatch {
  readonly routeId: string;
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
  readonly staticData: { readonly admin?: AdminPage; readonly adminTab?: AdminTab };
}

interface AdminRoute {
  readonly id: string;
  readonly fullPath: string;
  readonly options: { readonly staticData?: AdminMatch["staticData"] };
}

interface AdminRouteNode {
  readonly parentRoute: AdminRouteNode;
  readonly children?: readonly AdminRoute[];
}

/** The route `routeId` names, with its parent and children, which TanStack leaves untyped. */
export const routeOf = (router: AnyRouter, routeId: string) =>
  router.routesById[routeId] as AdminRouteNode;

const titleOf = ({ title }: AdminPage, params: AdminMatch["params"]) =>
  typeof title === "string" ? title : title(params);

/**
 * Polaris's `s-link` and `s-button` as TanStack links: the `href` for the browser, and the app's
 * own navigation for a plain click. Polaris types `onClick` as taking an `Event` where React hands
 * its synthetic event, which TanStack's handler reads, so the props pass through untyped.
 */
export const AdminLink = createLink((props: ComponentProps<"a"> & { readonly slot?: string }) => (
  <s-link {...(props as object)} />
));

export const AdminLinkButton = createLink(
  (props: ComponentProps<"a"> & { readonly variant?: "primary" | "secondary" }) => (
    <s-button {...(props as object)} />
  ),
);

/**
 * A list page's `validateSearch`: a search `schema` rejects, such as a stale or hand-edited cursor,
 * reads as `firstPage` instead of failing the page. `firstPage` names each key as `undefined`,
 * since TanStack lays a route's search over the raw search and would keep a key left out.
 */
export const searchOrFirstPage = <T extends object>(schema: Schema.Decoder<T>, firstPage: T) => {
  const decode = Schema.decodeUnknownOption(schema);
  return (search: Record<string, unknown>): T => Option.getOrElse(decode(search), () => firstPage);
};

/**
 * Every admin loader's `staleReloadMode`: a revisit waits for a fresh reading instead of painting
 * the last one, since an admin comes back to check whether something just changed.
 */
export const STALE_RELOAD_MODE = "blocking" as const;

/** A call to one of the app's server functions, which the app creates and hands its route. */
export type ServerCall<Input, Output> = (options: { readonly data: Input }) => Promise<Output>;

/** How a press ended when the server function sent the browser elsewhere, as to sign-in. */
export const REDIRECTED = "Redirected";

/**
 * `call` as TanStack Start's `useServerFn` makes it: a redirect the server function throws is
 * followed in the app and answers {@link REDIRECTED}.
 */
export const useServerCall = <Input, Output>(call: ServerCall<Input, Output>) => {
  const router: AnyRouter = useRouter();
  return async (data: Input): Promise<Output | typeof REDIRECTED> => {
    try {
      return await call({ data });
    } catch (error) {
      if (!isRedirect(error)) throw error;
      await router.navigate(router.resolveRedirect(error).options);
      return REDIRECTED;
    }
  };
};

/**
 * The section's one page. Its heading is the deepest matched admin page's title, its breadcrumb
 * the admin page above that, and Sign out returns to the sign-in page.
 */
function AdminChrome({ children }: { readonly children: ReactNode }) {
  const router: AnyRouter = useRouter();
  const pages = (useMatches() as unknown as readonly AdminMatch[]).flatMap((match) =>
    match.staticData.admin === undefined ? [] : [{ match, page: match.staticData.admin }],
  );
  const current = pages.at(-1);
  const parent = pages.at(-2);
  return (
    <s-page
      heading={current === undefined ? "" : titleOf(current.page, current.match.params)}
      inlineSize="large"
    >
      {parent !== undefined && (
        <AdminLink
          slot="breadcrumb-actions"
          to={parent.match.pathname}
          activeOptions={{ exact: true }}
        >
          {titleOf(parent.page, parent.match.params)}
        </AdminLink>
      )}
      <SignOutButton
        slot="secondary-actions"
        onSignedOut={() => {
          void router.navigate({ to: ADMIN_SIGN_IN_PATH });
        }}
      />
      {children}
    </s-page>
  );
}

function AdminLayout() {
  return (
    <AdminChrome>
      <Outlet />
    </AdminChrome>
  );
}

/** A failure anywhere under `/admin`, as a banner in the page it failed on. */
function AdminError({ error }: ErrorComponentProps) {
  return (
    <AdminChrome>
      <s-banner tone="critical" heading={error instanceof Error ? error.message : String(error)} />
    </AdminChrome>
  );
}

/**
 * The `/admin` layout route's options. The app spreads them and adds its guard, a `beforeLoad`
 * that redirects a signed-out visitor to the sign-in page. A route under it without its own
 * `errorComponent` fails into this one, so the banner keeps the page's heading and Sign out.
 */
export const adminLayout = {
  staticData: { admin: { title: "Admin" } },
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow" }] }),
  component: AdminLayout,
  errorComponent: AdminError,
};

function AdminHome() {
  const router: AnyRouter = useRouter();
  const { routeId } = useMatch({ strict: false }) as unknown as AdminMatch;
  const pages = (routeOf(router, routeId).parentRoute.children ?? [])
    .flatMap((route) => {
      const page = route.options.staticData?.admin;
      return page !== undefined && "summary" in page && page.summary !== undefined
        ? [{ route, title: page.title, summary: page.summary, order: page.order ?? Infinity }]
        : [];
    })
    .toSorted((a, b) => a.order - b.order);
  return (
    <s-section accessibilityLabel="Admin pages">
      <s-stack gap="base">
        {pages.map(({ route, title, summary }) => (
          <s-stack key={route.id} gap="small-300">
            <AdminLink to={route.fullPath}>{title}</AdminLink>
            <s-text color="subdued">{summary}</s-text>
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}

/** The `/admin/` index route's options: the section's pages that have a `summary`, in `order`. */
export const adminHome = { component: AdminHome };
