/**
 * The App Home's counter in the real Shopify admin: two tabs each hold an open socket to the
 * shop's actor, and an Increment in one shows in both, the other through its notice.
 *
 * @module
 */

import { expect, openApp, test } from "@mw10013/shopify-app-workers/test/e2e";
import type { FrameLocator } from "playwright/test";

test("an Increment in one tab shows in another through the actor's notice", async ({
  page,
  context,
  app,
}) => {
  const ready = (frame: FrameLocator) => frame.getByTestId("count");
  const first = await openApp(page, app, ready);
  const second = await openApp(await context.newPage(), app, ready);
  if (first._tag !== "App" || second._tag !== "App")
    throw new Error("the lifecycle leaves the store on a plan, so the App Home opens");
  for (const { frame } of [first, second])
    await expect(frame.getByTestId("actor-socket")).toHaveText("open");

  const before = Number(await first.frame.getByTestId("count").textContent());
  await first.frame.getByRole("button", { name: "Increment" }).click();
  await expect(first.frame.getByTestId("count")).toHaveText(String(before + 1));
  await expect(second.frame.getByTestId("count")).toHaveText(String(before + 1));
});
