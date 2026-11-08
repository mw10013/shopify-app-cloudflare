/**
 * The lifecycle: install, subscribe, change plan, uninstall and reinstall the app on the leased
 * store, through Shopify's own screens, checking each step against the App Home and the e2e status
 * route. It starts from any state a failed run leaves (no row, the app uninstalled or without its
 * dev preview, either plan, a cancelled plan) and ends installed on the cheapest plan. It switches plan at most three times, since Shopify's
 * plan selection can rate limit. Its own project runs it before every other spec, which then finds
 * the store installed on a plan, served by the server it restarted. It trusts no starting state:
 * the status route's row can outlive the app's install, and the dev preview can have ended, so it
 * always opens the install URL and checks that the app's frame loads the tunnel.
 *
 * @module
 */

import { performance } from "node:perf_hooks";

import { appFrame, awaitHydration, closeDevConsole } from "@mw10013/devkit/shopify/embedded-app";
import * as DateTime from "effect/DateTime";
import type { BrowserContext, Page } from "playwright/test";

import {
  type AdminLanding,
  approveInstall,
  awaitLanding,
  choosePlan,
  currentPlan,
  installUrl,
  planSelectionUrl,
  restartServer,
  ShopifyScreenError,
  uninstall,
} from "./admin.ts";
import { appBaseUrl, type E2eApp, type E2ePlan, shopOf } from "./app.ts";
import { adminContext, expect, openApp, readShopStatus, test } from "./fixtures.ts";

/** Shopify can take seconds to minutes to deliver `app/uninstalled`. */
const UNINSTALL_DELIVERY_TIMEOUT = 3 * 60_000;

/** A restarted server answers once Alchemy has deployed its Workers. */
const SERVER_READY_TIMEOUT = 2 * 60_000;

test("the app installs, subscribes, changes plan, uninstalls and reinstalls", async ({
  browser,
  app: initial,
  adminAuthFile,
}) => {
  test.setTimeout(20 * 60_000);
  if (adminAuthFile === undefined)
    throw new Error("No adminAuthFile: register the pack's projects with e2eProjects(app, root)");
  const shop = shopOf(initial);
  const [first, second] = initial.plans;

  let app: E2eApp = initial;
  let context: BrowserContext = await adminContext(browser, app, adminAuthFile);
  let page: Page = await context.newPage();
  const status = () => readShopStatus(app, shop);

  /** The App Home, hydrated, names the shop and `plan`. */
  const expectAppHome = async (plan: E2ePlan) => {
    const frame = appFrame(page);
    await awaitHydration(frame, 30_000);
    await closeDevConsole(page);
    await expect(frame.getByTestId("shop")).toHaveText(shop);
    await expect(frame.getByTestId("plan-handle")).toHaveText(plan.handle);
  };

  /** Restarts the server, so its `shopify app dev` installs a dev preview on the store again. */
  const restart = async () => {
    await context.close();
    app = await restartServer(app);
    await expect
      .poll(
        () =>
          status().then(
            () => true,
            () => false,
          ),
        {
          message: `the restarted e2e server's status route on port ${String(app.server.port)}`,
          timeout: SERVER_READY_TIMEOUT,
          intervals: [1000],
        },
      )
      .toBe(true);
    context = await adminContext(browser, app, adminAuthFile);
    page = await context.newPage();
  };

  /**
   * Opens the admin install URL until it lands in the app or on plan selection: Install on
   * Shopify's install page, and a restart when the store has the app but no dev preview of it.
   */
  const install = async (): Promise<AdminLanding> => {
    let restarted = false;
    for (;;) {
      await page.goto(installUrl(app), { waitUntil: "commit" });
      let landing = await awaitLanding(page, app);
      if (landing._tag === "Installing") {
        await approveInstall(page, app);
        landing = await awaitLanding(page, app);
      }
      if (landing._tag !== "DevPreviewEnded") return landing;
      if (restarted)
        throw new ShopifyScreenError(
          `The app's frame still loads ${landing.src} after a restart of the e2e server, so its shopify app dev installed no dev preview on ${shop}: read vp run e2e:logs.`,
        );
      await restart();
      restarted = true;
    }
  };

  /**
   * Waits for the app's frame where the admin sent the merchant, and restarts the server when it
   * loads the app's released URL: plan selection, where {@link install} can land, shows no frame
   * to tell an ended dev preview by.
   */
  const awaitApp = async () => {
    const landing = await awaitLanding(page, app);
    if (landing._tag === "App") return;
    if (landing._tag !== "DevPreviewEnded")
      throw new ShopifyScreenError(
        `Expected the app on ${shop}, the admin landed on ${landing._tag}: read the test's page attachment.`,
      );
    await restart();
    const reopened = await openApp(page, app, (frame) => frame.getByTestId("shop"));
    expect(reopened._tag).toBe("App");
  };

  await test.step("installed", async () => {
    await install();
    await expect.poll(async () => (await status()).installed).toBe(true);
  });

  await test.step(`subscribed to ${first.name}`, async () => {
    await page.goto(planSelectionUrl(app), { waitUntil: "commit" });
    const changed = await choosePlan(page, app, first);
    test.info().annotations.push({
      type: "first plan",
      description: changed ? "chosen" : "already current",
    });
    if (!changed) await page.goto(appBaseUrl(app), { waitUntil: "commit" });
    await awaitApp();
    await expectAppHome(first);
    expect((await status()).planHandle).toBe(first.handle);
  });

  if (second !== undefined)
    await test.step(`changed to ${second.name}`, async () => {
      await page.goto(planSelectionUrl(app), { waitUntil: "commit" });
      expect(await choosePlan(page, app, second)).toBe(true);
      await expectAppHome(second);
      const landing = await openApp(page, app, (frame) => frame.getByTestId("shop"));
      expect(landing._tag).toBe("App");
      await expectAppHome(second);
      expect((await status()).planHandle).toBe(second.handle);
    });

  const before = await status();
  await test.step("uninstalled", async () => {
    await uninstall(page, app);
    const started = performance.now();
    await expect
      .poll(async () => (await status()).installed, {
        message: `the app/uninstalled webhook deleting ${shop}'s AppInstallation row within ${String(UNINSTALL_DELIVERY_TIMEOUT / 1000)} s`,
        timeout: UNINSTALL_DELIVERY_TIMEOUT,
        intervals: [1000],
      })
      .toBe(false);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    test.info().annotations.push({ type: "app/uninstalled", description: `${seconds} s` });
    console.log(`app/uninstalled deleted the row ${seconds} s after Shopify confirmed`);
  });

  await test.step(`reinstalled, then subscribed to ${first.name}`, async () => {
    const landing = await install();
    const after = await status();
    expect(after.installed).toBe(true);
    if (before.installedAt === null || after.installedAt === null)
      throw new Error("the status route answered an installed row with no installedAt");
    expect(DateTime.isGreaterThan(after.installedAt, before.installedAt)).toBe(true);
    // Shopify cancels the subscription on uninstall, but a cancelled plan runs until its period
    // ends ("Subscription expires <date>" on plan selection), so the reinstalled app opens on
    // the plan it held; once the period has ended it lands on plan selection.
    if (landing._tag === "App") {
      expect(app.plans.map(({ handle }) => handle)).toContain(before.planHandle);
      expect(after.planHandle).toBe(before.planHandle);
    } else {
      expect(landing._tag).toBe("PlanSelection");
      expect(after.planHandle).toBeNull();
    }
    test.info().annotations.push({ type: "reinstalled landing", description: landing._tag });
    expect(await currentPlan(page, app), "no plan is current after the uninstall").toBeUndefined();
    expect(await choosePlan(page, app, first)).toBe(true);
    await expectAppHome(first);
    expect((await status()).planHandle).toBe(first.handle);
  });
});
