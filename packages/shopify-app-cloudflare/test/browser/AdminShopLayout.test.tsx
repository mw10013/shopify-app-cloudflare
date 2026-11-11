import type { ShopDomain } from "@mw10013/shopify-app-cloudflare/contract";
import { AdminShopLayout } from "@mw10013/shopify-app-cloudflare/website/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import * as Function from "effect/Function";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

const SHOP = "tabs.myshopify.com" as ShopDomain;

const shopRouter = () => {
  const root = createRootRoute();
  const layout = createRoute({
    getParentRoute: () => root,
    path: "/admin/shop/$shop",
    component: () => (
      <AdminShopLayout
        shop={SHOP}
        shopsLink={{ href: "/admin/shops", onClick: Function.constVoid }}
      />
    ),
  });
  const actor = createRoute({
    getParentRoute: () => layout,
    path: "actor",
    staticData: { adminTab: { label: "Actor", order: 20 } },
    component: () => <p>Actor page</p>,
  });
  const untagged = createRoute({
    getParentRoute: () => layout,
    path: "untagged",
    component: () => <p>Untagged page</p>,
  });
  const overview = createRoute({
    getParentRoute: () => layout,
    path: "/",
    staticData: { adminTab: { label: "Overview", order: 0 } },
    component: () => <p>Overview page</p>,
  });
  return createRouter({
    routeTree: root.addChildren([layout.addChildren([actor, untagged, overview])]),
    history: createMemoryHistory({ initialEntries: [`/admin/shop/${SHOP}`] }),
  });
};

const tabs = (container: HTMLElement) =>
  [...container.querySelectorAll("s-button[href]")].map((tab) => ({
    label: tab.textContent,
    variant: tab.getAttribute("variant"),
    href: tab.getAttribute("href"),
  }));

describe("AdminShopLayout", () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("tabs its tagged child routes in order, and a click shows the child and marks its tab", async () => {
    const router = shopRouter();
    const screen = await render(<RouterProvider router={router} />);
    await expect.element(screen.getByText("Overview page")).toBeVisible();
    expect(tabs(screen.container)).toStrictEqual([
      { label: "Overview", variant: "primary", href: `/admin/shop/${SHOP}` },
      { label: "Actor", variant: "secondary", href: `/admin/shop/${SHOP}/actor` },
    ]);

    await screen.getByRole("link", { name: "Actor" }).click();
    await expect.element(screen.getByText("Actor page")).toBeVisible();
    expect(router.state.location.pathname).toBe(`/admin/shop/${SHOP}/actor`);
    expect(tabs(screen.container).map(({ label, variant }) => ({ label, variant }))).toStrictEqual([
      { label: "Overview", variant: "secondary" },
      { label: "Actor", variant: "primary" },
    ]);
  });
});
