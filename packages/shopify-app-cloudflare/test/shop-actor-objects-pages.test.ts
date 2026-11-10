import { assert, describe, it } from "@effect/vitest";
import {
  type DestroyOutcome,
  OrphanShopActorObjectsPage,
  type OrphanShopActorObjectsPageProps,
  ShopActorObjectsPage,
  type ShopActorObjectsPageProps,
} from "@mw10013/shopify-app-cloudflare/website/react";
import * as Function from "effect/Function";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const INSTALLED_AGAIN = "This shop was installed again, so its object is no longer an orphan.";

const orphanPage = (data: OrphanShopActorObjectsPageProps["data"]) =>
  renderToStaticMarkup(
    createElement(OrphanShopActorObjectsPage, {
      data,
      cursor: undefined,
      adminLink: { onClick: Function.constVoid },
      onNavigate: Function.constVoid,
      onDestroy: () => Promise.resolve<DestroyOutcome>("Destroyed"),
    }),
  );

const inventoryPage = (
  props: Partial<ShopActorObjectsPageProps> & Pick<ShopActorObjectsPageProps, "data">,
) =>
  renderToStaticMarkup(
    createElement(ShopActorObjectsPage, {
      cursor: undefined,
      page: 0,
      adminLink: { onClick: Function.constVoid },
      onNavigate: Function.constVoid,
      ...props,
    }),
  );

const occurrences = (html: string, text: string) => html.split(text).length - 1;

describe("OrphanShopActorObjectsPage", () => {
  const batch = {
    orphans: [
      { id: "with-data", name: "uninstalled.myshopify.com", hasStoredData: true },
      { id: "tombstone", hasStoredData: false },
      { id: "unreported" },
    ],
    cursor: undefined,
  };

  it("is titled and has its four columns", () => {
    const html = orphanPage(batch);
    assert.include(html, 'heading="Orphan Shop Actor Objects"');
    for (const column of ["Object ID", "Name", "Stored data", "Action"])
      assert.include(html, `>${column}</s-table-header>`);
  });

  it("shows each orphan's stored data as a badge or the text undefined, with Destroy unless it is a tombstone", () => {
    const html = orphanPage(batch);
    assert.include(html, '<s-badge tone="success">Yes</s-badge>');
    assert.include(html, '<s-badge tone="neutral">No</s-badge>');
    assert.include(html, '<s-text tone="neutral">undefined</s-text>');
    assert.strictEqual(occurrences(html, ">Destroy</s-button>"), 2);
    const tombstone = html.slice(html.indexOf('id="tombstone"'), html.indexOf('id="unreported"'));
    assert.notInclude(tombstone, "Destroy");
    assert.include(html, 'tone="critical"');
  });

  it("an empty batch says to check the next batch when there is one, and No orphans when it is the last", () => {
    const more = orphanPage({ orphans: [], cursor: "next" });
    assert.include(more, "No orphans in this batch of 1000. Check the next batch.");
    assert.include(more, '<s-banner tone="info">');
    assert.notInclude(more, "No orphans.");
    const last = orphanPage({ orphans: [], cursor: undefined });
    assert.include(last, '<s-banner tone="success">No orphans.</s-banner>');
    assert.notInclude(last, "Check the next batch.");
  });

  it("a batch with orphans shows no empty-batch banner, and the installed-again warning waits for a press", () => {
    const html = orphanPage({ ...batch, cursor: "next" });
    assert.notInclude(html, "No orphans");
    assert.notInclude(html, INSTALLED_AGAIN);
  });
});

describe("ShopActorObjectsPage", () => {
  it("is titled, lists each object's stored data and offers no Destroy", () => {
    const html = inventoryPage({
      data: {
        objects: [
          { id: "with-data", name: "live.myshopify.com", hasStoredData: true },
          { id: "unreported" },
        ],
      },
    });
    assert.include(html, 'heading="Shop Actor Objects"');
    assert.include(html, '<s-badge tone="success">Yes</s-badge>');
    assert.include(html, '<s-text tone="neutral">undefined</s-text>');
    assert.notInclude(html, "Destroy");
    assert.notInclude(html, "No Shop Actor objects found.");
  });

  it("an empty batch says so", () => {
    assert.include(inventoryPage({ data: { objects: [] } }), "No Shop Actor objects found.");
  });

  it("shows 50 objects to a table page and a next page while more remain in the batch", () => {
    const objects = Array.from({ length: 120 }, (_, index) => ({ id: `object-${String(index)}` }));
    const first = inventoryPage({ data: { objects } });
    assert.include(first, 'id="object-49"');
    assert.notInclude(first, 'id="object-50"');
    assert.include(first, "hasNextPage");
    const last = inventoryPage({ data: { objects }, page: 2 });
    assert.include(last, 'id="object-119"');
    assert.notInclude(last, 'id="object-99"');
    assert.notInclude(last, "hasNextPage");
  });
});
