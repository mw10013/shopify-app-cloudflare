import type { OrphanShopActorObjectsData } from "@mw10013/shopify-app-cloudflare/contract";
import {
  OrphanShopActorObjectsPage,
  type OrphanShopActorObjectsPageProps,
} from "@mw10013/shopify-app-cloudflare/website/react";
import * as Function from "effect/Function";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

const INSTALLED_AGAIN = "This shop was installed again, so its object is no longer an orphan.";

const batch: OrphanShopActorObjectsData = {
  orphans: [
    { id: "with-data", name: "uninstalled.myshopify.com", hasStoredData: true },
    { id: "tombstone", hasStoredData: false },
    { id: "unreported" },
  ],
};

const orphanPage = (
  data: OrphanShopActorObjectsData,
  props: Partial<OrphanShopActorObjectsPageProps> = {},
) =>
  render(
    <OrphanShopActorObjectsPage
      data={data}
      cursor={undefined}
      adminLink={{ href: "/admin", onClick: Function.constVoid }}
      onNavigate={Function.constVoid}
      onDestroy={() => Promise.resolve("Destroyed")}
      {...props}
    />,
  );

describe("OrphanShopActorObjectsPage", () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("is titled, has its four columns, and shows each orphan's stored data with Destroy unless it is a tombstone", async () => {
    const screen = await orphanPage(batch);
    await expect
      .element(screen.getByRole("heading", { name: "Orphan Shop Actor Objects" }))
      .toBeVisible();
    for (const column of ["Object ID", "Name", "Stored data", "Action"])
      await expect.element(screen.getByRole("columnheader", { name: column })).toBeVisible();
    for (const text of ["uninstalled.myshopify.com", "Yes", "No", "undefined"])
      await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
    // Polaris slots each cell into its row, so a row is read by its accessible name, not its box.
    for (const row of [
      "with-data uninstalled.myshopify.com Yes Destroy",
      "tombstone No",
      "unreported undefined Destroy",
    ])
      await expect.element(screen.getByRole("row", { name: row })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Destroy" }).elements()).toHaveLength(2);
  });

  it("the Admin breadcrumb links to its href, and a click runs the app's navigation in place of loading it", async () => {
    let clicks = 0;
    const screen = await orphanPage(batch, {
      adminLink: {
        href: "/admin",
        onClick: () => {
          clicks++;
        },
      },
    });
    const admin = screen.getByRole("link", { name: "Admin" });
    await expect.element(admin).toHaveAttribute("href", "/admin");
    const before = location.href;
    await admin.click();
    expect(clicks).toBe(1);
    expect(location.href).toBe(before);
  });

  it("Destroy presses with its row's object id", async () => {
    const destroyed: string[] = [];
    const screen = await orphanPage(batch, {
      onDestroy: (id) => {
        destroyed.push(id);
        return Promise.resolve("Destroyed");
      },
    });
    await screen.getByRole("button", { name: "Destroy" }).last().click();
    expect(destroyed).toStrictEqual(["unreported"]);
    expect(screen.getByText(INSTALLED_AGAIN).query()).toBeNull();
  });

  it("Destroy of a shop installed again shows the warning, and the next Destroy clears it", async () => {
    const outcomes: ("Destroyed" | "InstalledAgain")[] = ["InstalledAgain", "Destroyed"];
    const screen = await orphanPage(
      { orphans: [{ id: "reinstalled", hasStoredData: true }] },
      { onDestroy: () => Promise.resolve(outcomes.shift() ?? "Destroyed") },
    );
    await screen.getByRole("button", { name: "Destroy" }).click();
    await expect.element(screen.getByText(INSTALLED_AGAIN)).toBeVisible();
    await screen.getByRole("button", { name: "Destroy" }).click();
    await expect.element(screen.getByText(INSTALLED_AGAIN)).not.toBeInTheDocument();
  });

  it("an empty batch says to check the next batch when there is one, and No orphans when it is the last", async () => {
    const more = await orphanPage({ orphans: [], cursor: "next" });
    await expect
      .element(more.getByText("No orphans in this batch of 1000. Check the next batch."))
      .toBeVisible();
    expect(more.getByText("No orphans.", { exact: true }).query()).toBeNull();
    await more.unmount();
    const last = await orphanPage({ orphans: [] });
    await expect.element(last.getByText("No orphans.", { exact: true })).toBeVisible();
    expect(last.getByText("Check the next batch.").query()).toBeNull();
  });

  it("a batch with orphans shows no empty-batch banner", async () => {
    const screen = await orphanPage({ ...batch, cursor: "next" });
    await expect.element(screen.getByText("tombstone", { exact: true })).toBeVisible();
    expect(screen.getByText("No orphans").query()).toBeNull();
  });

  it("the next batch goes to the batch's cursor, and back returns to the one before", async () => {
    const navigated: (string | undefined)[] = [];
    const screen = await orphanPage(
      { ...batch, cursor: "second" },
      {
        onNavigate: (cursor) => {
          navigated.push(cursor);
        },
      },
    );
    await screen.getByRole("button", { name: "Go to next page" }).click();
    await screen.getByRole("button", { name: "Go to previous page" }).click();
    expect(navigated).toStrictEqual(["second", undefined]);
  });
});
