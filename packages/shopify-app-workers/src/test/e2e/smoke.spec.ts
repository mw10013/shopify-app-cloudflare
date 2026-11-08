/**
 * The smoke: the app opens in the leased store's admin. A store with a plan shows the App Home,
 * which names the shop and the plan the status route shows; a store with none lands on Shopify's
 * plan selection page, the expected landing for an unsubscribed shop, and the status route shows
 * the shop installed with no plan. The smoke never picks a plan; the lifecycle, which runs before
 * it, leaves the store on one, so the smoke proves the App Home.
 *
 * @module
 */

import { shopOf } from "./app.ts";
import { expect, openApp, planSelectionUrl, test } from "./fixtures.ts";

test("the app opens in the store's admin for the leased shop", async ({
  page,
  app,
  shopStatus,
}) => {
  const shop = shopOf(app);
  const landing = await openApp(page, app, (frame) => frame.getByTestId("shop"));
  test.info().annotations.push({ type: "landing", description: landing._tag });
  const status = await shopStatus(shop);
  expect(status.shop).toBe(shop);
  expect(status.installed).toBe(true);
  if (landing._tag === "App") {
    await expect(landing.frame.getByTestId("shop")).toHaveText(shop);
    expect(app.plans.map(({ handle }) => handle)).toContain(status.planHandle);
    await expect(landing.frame.getByTestId("plan-handle")).toHaveText(status.planHandle ?? "");
  } else {
    expect(page.url()).toContain(planSelectionUrl(app));
    expect(status.planHandle).toBeNull();
  }
});
