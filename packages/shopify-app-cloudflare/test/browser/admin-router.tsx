import type {
  AdminShopData,
  AdminShopRequest,
  AppInstallationRedactedPage,
  AppInstallationsPageRequest,
  DestroyOrphanRequest,
  OrphanShopActorObjectsData,
  ShopActorObjectsData,
  ShopActorObjectsRequest,
} from "@mw10013/shopify-app-cloudflare/contract";
import {
  adminHome,
  adminLayout,
  adminOrphanShopActorObjects,
  adminShop,
  adminShopActorObjects,
  adminShopOverview,
  adminShops,
  adminShopsList,
  type ServerCall,
} from "@mw10013/shopify-app-cloudflare/website/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { render } from "vitest-browser-react";

/** What the app's `/admin` guard reads. */
export interface Session {
  signedIn: boolean;
}

/** A server function's failure once the session ended, as the Backend's binding rejects with it. */
export const UNAUTHORIZED = { _tag: "UnauthorizedError" } as const;

const SIGNED_IN: Session = { signedIn: true };

function SignIn({ session }: { readonly session: Session }) {
  const router = useRouter();
  const { redirect: returnTo } = useSearch({ strict: false }) as unknown as {
    readonly redirect?: string;
  };
  return (
    <button
      type="button"
      onClick={() => {
        session.signedIn = true;
        void router.navigate({ href: returnTo ?? "/admin" });
      }}
    >
      Test sign in
    </button>
  );
}

/** The server functions an app hands the admin routes, each a test's own. */
export interface AdminCalls {
  readonly shops?: ServerCall<AppInstallationsPageRequest, AppInstallationRedactedPage>;
  readonly shop?: ServerCall<AdminShopRequest, AdminShopData>;
  readonly refreshPlan?: ServerCall<AdminShopRequest, string | null>;
  readonly objects?: ServerCall<ShopActorObjectsRequest, ShopActorObjectsData>;
  readonly orphans?: ServerCall<ShopActorObjectsRequest, OrphanShopActorObjectsData>;
  readonly destroy?: ServerCall<DestroyOrphanRequest, null | { _tag: "OrphanInstalledError" }>;
}

const EMPTY_PAGE: AppInstallationRedactedPage = {
  appInstallations: [],
  limit: 25,
  startCursor: null,
  endCursor: null,
  hasPreviousPage: false,
  hasNextPage: false,
};

/**
 * An app's admin section as the README tells it to write one: SAC's route options spread under
 * `/admin` beside the app's guard, its own sign-in page outside the layout, an app page with a
 * summary, and an app tab on the shop page.
 */
export const adminRouter = (path: string, calls: AdminCalls = {}, session: Session = SIGNED_IN) => {
  const root = createRootRoute();
  const admin = createRoute({
    ...adminLayout,
    getParentRoute: () => root,
    path: "admin",
    beforeLoad: ({ location }) => {
      if (!session.signedIn)
        throw redirect({ to: "/admin/sign-in", search: { redirect: location.href } });
    },
  });
  const signIn = createRoute({
    getParentRoute: () => root,
    path: "admin/sign-in",
    validateSearch: (search: Record<string, unknown>): { readonly redirect?: string } =>
      typeof search.redirect === "string" ? { redirect: search.redirect } : {},
    component: () => <SignIn session={session} />,
  });
  const home = createRoute({ ...adminHome, getParentRoute: () => admin, path: "/" });
  const shops = createRoute({ ...adminShops, getParentRoute: () => admin, path: "shops" });
  const shopsList = createRoute({
    ...adminShopsList({ load: calls.shops ?? (() => Promise.resolve(EMPTY_PAGE)) }),
    getParentRoute: () => shops,
    path: "/",
  });
  const shop = createRoute({ ...adminShop, getParentRoute: () => shops, path: "$shop" });
  const overview = createRoute({
    ...adminShopOverview({
      load: calls.shop ?? (() => Promise.resolve({ _tag: "NotFound" as const })),
      refreshPlan: calls.refreshPlan ?? (() => Promise.resolve(null)),
    }),
    getParentRoute: () => shop,
    path: "/",
  });
  const actor = createRoute({
    getParentRoute: () => shop,
    path: "actor",
    staticData: { adminTab: { label: "Actor", order: 10 } },
    component: () => <p>Actor tab</p>,
  });
  const untagged = createRoute({
    getParentRoute: () => shop,
    path: "untagged",
    component: () => <p>Untagged page</p>,
  });
  const objects = createRoute({
    ...adminShopActorObjects({ load: calls.objects ?? (() => Promise.resolve({ objects: [] })) }),
    getParentRoute: () => admin,
    path: "shop-actor-objects",
  });
  const orphans = createRoute({
    ...adminOrphanShopActorObjects({
      load: calls.orphans ?? (() => Promise.resolve({ orphans: [] })),
      destroy: calls.destroy ?? (() => Promise.resolve(null)),
    }),
    getParentRoute: () => admin,
    path: "orphan-shop-actor-objects",
  });
  const members = createRoute({
    getParentRoute: () => admin,
    path: "members",
    staticData: { admin: { title: "Members", summary: "The app's own page.", order: 15 } },
    component: () => <s-section>Members page</s-section>,
  });
  const unlisted = createRoute({
    getParentRoute: () => admin,
    path: "unlisted",
    staticData: { admin: { title: "Unlisted" } },
    component: () => <s-section>Unlisted page</s-section>,
  });
  return createRouter({
    routeTree: root.addChildren([
      signIn,
      admin.addChildren([
        home,
        shops.addChildren([shopsList, shop.addChildren([overview, actor, untagged])]),
        objects,
        orphans,
        members,
        unlisted,
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
};

export const renderAdmin = async (path: string, calls?: AdminCalls, session?: Session) => {
  const router = adminRouter(path, calls, session);
  const screen = await render(<RouterProvider router={router} />);
  return { router, screen };
};
