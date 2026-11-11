import type { ShopDomain, ShopGid } from "@mw10013/shopify-app-cloudflare/contract";
import * as DateTime from "effect/DateTime";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { renderAdmin, type Session, UNAUTHORIZED } from "./admin-router.tsx";

const SHOP = "tabs.myshopify.com" as ShopDomain;
const INSTALLED_AT = DateTime.makeUnsafe("2026-03-04T05:06:07Z");
const ROW = {
  shop: SHOP,
  shopGid: "gid://shopify/Shop/1" as ShopGid,
  scope: "read_products",
  hasAccessToken: true,
  accessTokenExpiresAt: null,
  planHandle: null,
  planHandleExpiresAt: null,
  planBoundaryAt: null,
  installedAt: INSTALLED_AT,
};

const tabs = (container: HTMLElement) =>
  [...container.querySelectorAll("s-button[href]")].map((tab) => ({
    label: tab.textContent,
    variant: tab.getAttribute("variant"),
    href: tab.getAttribute("href"),
  }));

describe("the admin section", () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("home lists /admin's pages that have a summary, in order, each linking to its page", async () => {
    const { screen } = await renderAdmin("/admin");
    await expect.element(screen.getByRole("heading", { name: "Admin" })).toBeVisible();
    const links = [...screen.container.querySelectorAll("s-section s-link")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toStrictEqual([
      ["Shops", "/admin/shops"],
      ["Members", "/admin/members"],
      ["Shop Actor Objects", "/admin/shop-actor-objects"],
      ["Orphan Shop Actor Objects", "/admin/orphan-shop-actor-objects"],
    ]);
    await screen.getByRole("link", { name: "Members" }).click();
    await expect.element(screen.getByText("Members page")).toBeVisible();
  });

  it.each([
    { path: "/admin", heading: "Admin", breadcrumb: undefined },
    { path: "/admin/shops", heading: "Shops", breadcrumb: { label: "Admin", href: "/admin" } },
    {
      path: `/admin/shops/${SHOP}`,
      heading: SHOP,
      breadcrumb: { label: "Shops", href: "/admin/shops" },
    },
    {
      path: `/admin/shops/${SHOP}/actor`,
      heading: SHOP,
      breadcrumb: { label: "Shops", href: "/admin/shops" },
    },
    {
      path: "/admin/unlisted",
      heading: "Unlisted",
      breadcrumb: { label: "Admin", href: "/admin" },
    },
  ])(
    "$path is headed $heading, with its breadcrumb and Sign out",
    async ({ path, heading, breadcrumb }) => {
      const { screen } = await renderAdmin(path);
      await expect.element(screen.getByRole("heading", { name: heading })).toBeVisible();
      await expect.element(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
      const crumbs = [...screen.container.querySelectorAll('s-link[slot="breadcrumb-actions"]')];
      expect(
        crumbs.map((crumb) => ({ label: crumb.textContent, href: crumb.getAttribute("href") })),
      ).toStrictEqual(breadcrumb === undefined ? [] : [breadcrumb]);
    },
  );

  it("a breadcrumb click navigates in the app", async () => {
    const { router, screen } = await renderAdmin(`/admin/shops/${SHOP}`);
    await screen.getByRole("link", { name: "Shops" }).click();
    await expect.element(screen.getByText("No shops.")).toBeVisible();
    expect(router.state.location.pathname).toBe("/admin/shops");
  });

  it("a failure under /admin is a critical banner inside the page, with its heading, breadcrumb and Sign out", async () => {
    const { screen } = await renderAdmin("/admin/shops/not-a-shop");
    await expect.element(screen.getByText("not-a-shop is not a shop domain.")).toBeVisible();
    expect(screen.container.querySelector('s-banner[tone="critical"]')).not.toBeNull();
    await expect.element(screen.getByRole("heading", { name: "not-a-shop" })).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Shops" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  it("the shop page tabs its tagged child routes in order, and a click shows the child and marks its tab", async () => {
    const { router, screen } = await renderAdmin(`/admin/shops/${SHOP}`);
    await expect.element(screen.getByText("Not installed")).toBeVisible();
    expect(tabs(screen.container)).toStrictEqual([
      { label: "Overview", variant: "primary", href: `/admin/shops/${SHOP}` },
      { label: "Actor", variant: "secondary", href: `/admin/shops/${SHOP}/actor` },
    ]);

    await screen.getByRole("link", { name: "Actor" }).click();
    await expect.element(screen.getByText("Actor tab")).toBeVisible();
    expect(router.state.location.pathname).toBe(`/admin/shops/${SHOP}/actor`);
    expect(tabs(screen.container).map(({ label, variant }) => ({ label, variant }))).toStrictEqual([
      { label: "Overview", variant: "secondary" },
      { label: "Actor", variant: "primary" },
    ]);
  });

  it("Shops links each shop to its page and shows its instants in the viewer's time", async () => {
    const { router, screen } = await renderAdmin("/admin/shops", {
      shops: () =>
        Promise.resolve({
          appInstallations: [ROW],
          limit: 25,
          startCursor: SHOP,
          endCursor: SHOP,
          hasPreviousPage: false,
          hasNextPage: false,
        }),
    });
    const time = screen.getByText(
      DateTime.formatLocal(INSTALLED_AT, { dateStyle: "medium", timeStyle: "medium" }),
    );
    await expect.element(time).toHaveAttribute("datetime", "2026-03-04T05:06:07.000Z");
    await screen.getByRole("link", { name: SHOP }).click();
    await expect.element(screen.getByText("Not installed")).toBeVisible();
    expect(router.state.location.pathname).toBe(`/admin/shops/${SHOP}`);
  });

  it("Refresh plan calls the app's server function for the shop, then reads the shop again", async () => {
    const refreshed: unknown[] = [];
    let reads = 0;
    const { screen } = await renderAdmin(`/admin/shops/${SHOP}`, {
      shop: () => {
        reads++;
        return Promise.resolve({
          _tag: "Found" as const,
          appInstallation: ROW,
          plan: { _tag: "NeverFetched" as const },
          shopActorId: "actor-1",
        });
      },
      refreshPlan: ({ data }) => {
        refreshed.push(data);
        return Promise.resolve(null);
      },
    });
    await expect.element(screen.getByText("Never fetched")).toBeVisible();
    await screen.getByRole("button", { name: "Refresh plan" }).click();
    await expect.poll(() => reads).toBe(2);
    expect(refreshed).toStrictEqual([{ shop: SHOP }]);
  });

  it("Refresh plan shows the server function's failure as a banner", async () => {
    const { screen } = await renderAdmin(`/admin/shops/${SHOP}`, {
      shop: () =>
        Promise.resolve({
          _tag: "Found" as const,
          appInstallation: ROW,
          plan: { _tag: "NeverFetched" as const },
          shopActorId: "actor-1",
        }),
      refreshPlan: () => Promise.resolve("Shopify is unavailable."),
    });
    await screen.getByRole("button", { name: "Refresh plan" }).click();
    await expect.element(screen.getByText("Shopify is unavailable.")).toBeVisible();
  });

  it("a stale Shops cursor reads as the first page", async () => {
    const requests: unknown[] = [];
    const { router } = await renderAdmin("/admin/shops?after=%22not%20a%20shop%22&filter=%22x%22", {
      shops: ({ data }) => {
        requests.push(data);
        return Promise.resolve({
          appInstallations: [],
          limit: 25,
          startCursor: null,
          endCursor: null,
          hasPreviousPage: false,
          hasNextPage: false,
        });
      },
    });
    await expect.poll(() => requests).toEqual([{}]);
    expect(router.state.location.pathname).toBe("/admin/shops");
  });

  describe("a session that ends after the /admin guard passed", () => {
    const FOUND = {
      _tag: "Found" as const,
      appInstallation: ROW,
      plan: { _tag: "NeverFetched" as const },
      shopActorId: "actor-1",
    };
    const endSession = (session: Session) => {
      session.signedIn = false;
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the Backend's binding rejects with the plain encoded failure
      return Promise.reject(UNAUTHORIZED);
    };

    it("a loader sends the admin to the app's sign-in page with the page, and sign-in returns there", async () => {
      const session = { signedIn: true };
      let reads = 0;
      const { router, screen } = await renderAdmin(
        `/admin/shops/${SHOP}`,
        { shop: () => (reads++ === 0 ? endSession(session) : Promise.resolve(FOUND)) },
        session,
      );
      await expect.poll(() => router.state.location.pathname).toBe("/admin/sign-in");
      expect(router.state.location.search).toEqual({ redirect: `/admin/shops/${SHOP}` });
      await screen.getByRole("button", { name: "Test sign in" }).click();
      await expect.element(screen.getByText("Never fetched")).toBeVisible();
      expect(router.state.location.pathname).toBe(`/admin/shops/${SHOP}`);
      expect(screen.container.querySelector('s-banner[tone="critical"]')).toBeNull();
    });

    it("Refresh plan sends the admin to the app's sign-in page with the page, and sign-in returns there", async () => {
      const session = { signedIn: true };
      const { router, screen } = await renderAdmin(
        `/admin/shops/${SHOP}`,
        { shop: () => Promise.resolve(FOUND), refreshPlan: () => endSession(session) },
        session,
      );
      await screen.getByRole("button", { name: "Refresh plan" }).click();
      await expect.poll(() => router.state.location.pathname).toBe("/admin/sign-in");
      expect(router.state.location.search).toEqual({ redirect: `/admin/shops/${SHOP}` });
      await screen.getByRole("button", { name: "Test sign in" }).click();
      await expect.element(screen.getByText("Never fetched")).toBeVisible();
      expect(router.state.location.pathname).toBe(`/admin/shops/${SHOP}`);
      expect(screen.container.querySelector('s-banner[tone="critical"]')).toBeNull();
    });
  });
});
