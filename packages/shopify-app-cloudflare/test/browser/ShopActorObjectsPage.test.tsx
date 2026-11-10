import type { ShopActorObjectsData } from "@mw10013/shopify-app-cloudflare/contract";
import {
  ShopActorObjectsPage,
  type ShopActorObjectsPageProps,
  type ShopActorObjectsSearch,
} from "@mw10013/shopify-app-cloudflare/website/react";
import * as Function from "effect/Function";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

const NEXT = "Go to next page";
const PREVIOUS = "Go to previous page";

const objectsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `object-${String(index)}` }));

const inventoryPage = (
  data: ShopActorObjectsData,
  props: Partial<ShopActorObjectsPageProps> = {},
) =>
  render(
    <ShopActorObjectsPage
      data={data}
      cursor={undefined}
      page={0}
      adminLink={{ href: "/admin", onClick: Function.constVoid }}
      onNavigate={Function.constVoid}
      {...props}
    />,
  );

describe("ShopActorObjectsPage", () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("is titled, lists each object's stored data, and offers no Destroy", async () => {
    const screen = await inventoryPage({
      objects: [
        { id: "with-data", name: "live.myshopify.com", hasStoredData: true },
        { id: "unreported" },
      ],
    });
    await expect.element(screen.getByRole("heading", { name: "Shop Actor Objects" })).toBeVisible();
    for (const column of ["Object ID", "Name", "Stored data"])
      await expect.element(screen.getByRole("columnheader", { name: column })).toBeVisible();
    for (const row of ["with-data live.myshopify.com Yes", "unreported undefined"])
      await expect.element(screen.getByRole("row", { name: row })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Destroy" }).query()).toBeNull();
    expect(screen.getByText("No Shop Actor objects found.").query()).toBeNull();
  });

  it("an empty batch says so", async () => {
    const screen = await inventoryPage({ objects: [] });
    await expect.element(screen.getByText("No Shop Actor objects found.")).toBeVisible();
  });

  it("the Admin breadcrumb links to its href, and a click runs the app's navigation in place of loading it", async () => {
    let clicks = 0;
    const screen = await inventoryPage(
      { objects: [] },
      {
        adminLink: {
          href: "/admin",
          onClick: () => {
            clicks++;
          },
        },
      },
    );
    const admin = screen.getByRole("link", { name: "Admin" });
    await expect.element(admin).toHaveAttribute("href", "/admin");
    const before = location.href;
    await admin.click();
    expect(clicks).toBe(1);
    expect(location.href).toBe(before);
  });

  it("pages through the batch 50 at a time, then on to the next batch, and back", async () => {
    const navigated: ShopActorObjectsSearch[] = [];
    const onNavigate = (search: ShopActorObjectsSearch) => {
      navigated.push(search);
    };
    const data = { objects: objectsOf(120), cursor: "second" };
    const first = await inventoryPage(data, { onNavigate });
    await expect.element(first.getByText("object-49", { exact: true })).toBeVisible();
    expect(first.getByText("object-50", { exact: true }).query()).toBeNull();
    await first.getByRole("button", { name: NEXT }).click();
    await first.rerender(
      <ShopActorObjectsPage
        data={data}
        cursor={undefined}
        page={2}
        adminLink={{ href: "/admin", onClick: Function.constVoid }}
        onNavigate={onNavigate}
      />,
    );
    await expect.element(first.getByText("object-119", { exact: true })).toBeVisible();
    await first.getByRole("button", { name: NEXT }).click();
    await first.rerender(
      <ShopActorObjectsPage
        data={{ objects: objectsOf(1) }}
        cursor="second"
        page={0}
        adminLink={{ href: "/admin", onClick: Function.constVoid }}
        onNavigate={onNavigate}
      />,
    );
    await expect.element(first.getByRole("button", { name: NEXT })).toBeDisabled();
    await first.getByRole("button", { name: PREVIOUS }).click();
    expect(navigated).toStrictEqual([
      { cursor: undefined, page: 1 },
      { cursor: "second" },
      { cursor: undefined },
    ]);
  });
});
