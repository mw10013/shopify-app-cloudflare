import type { ShopActorObjectsData } from "@mw10013/shopify-app-cloudflare/contract";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { renderAdmin } from "./admin-router.tsx";

const NEXT = "Go to next page";
const PREVIOUS = "Go to previous page";

const objectsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `object-${String(index)}` }));

const inventoryPage = (data: ShopActorObjectsData) =>
  renderAdmin("/admin/shop-actor-objects", { objects: () => Promise.resolve(data) }).then(
    ({ screen }) => screen,
  );

describe("Shop Actor Objects", () => {
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

  it("pages through the batch 50 at a time, then on to the next batch, and back", async () => {
    const cursors: (string | undefined)[] = [];
    const { router, screen } = await renderAdmin("/admin/shop-actor-objects", {
      objects: ({ data: { cursor } }) => {
        cursors.push(cursor);
        return Promise.resolve(
          cursor === undefined
            ? { objects: objectsOf(120), cursor: "second" }
            : { objects: objectsOf(1) },
        );
      },
    });
    await expect.element(screen.getByText("object-49", { exact: true })).toBeVisible();
    expect(screen.getByText("object-50", { exact: true }).query()).toBeNull();
    await screen.getByRole("button", { name: NEXT }).click();
    await screen.getByRole("button", { name: NEXT }).click();
    await expect.element(screen.getByText("object-119", { exact: true })).toBeVisible();
    expect(router.state.location.search).toEqual({ page: 2 });
    await screen.getByRole("button", { name: NEXT }).click();
    await expect.poll(() => router.state.location.search).toEqual({ cursor: "second" });
    await expect.element(screen.getByRole("button", { name: NEXT })).toBeDisabled();
    await screen.getByRole("button", { name: PREVIOUS }).click();
    await expect.poll(() => router.state.location.search).toEqual({});
    expect(cursors).toStrictEqual([undefined, "second", undefined]);
  });
});
