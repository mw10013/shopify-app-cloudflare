import { E2eShopStatus } from "../../internal/e2e-status.mjs";
import { E2eApp, E2eOptions } from "./app.mjs";
import { planSelectionUrl } from "./admin.mjs";
import { Browser, BrowserContext, FrameLocator, Locator, Page, expect as expect$1 } from "playwright/test";
/** Reads the app's e2e status route for one shop. */
export type ShopStatusRead = (shop: string) => Promise<E2eShopStatus>;
/** Reads `app`'s e2e status route for `shop`. */
export declare const readShopStatus: (app: E2eApp, shop: string) => Promise<E2eShopStatus>;
/**
 * A context of its own in `browser` under the exported login, at the app's `baseURL` and routed to
 * `app`'s server, as the `context` fixture is: for a spec that outlives its server, since a context
 * is routed to one. A failed test gets its pages' snapshots, and the context closes after the
 * test if the spec has not closed it.
 */
export declare const adminContext: (browser: Browser, app: E2eApp, adminAuthFile: string) => Promise<BrowserContext>;
declare const test$1: import("playwright/test").TestType<import("playwright/test").PlaywrightTestArgs & import("playwright/test").PlaywrightTestOptions & {
  shopStatus: ShopStatusRead;
  ownContextsTeardown: undefined;
}, import("playwright/test").PlaywrightWorkerArgs & import("playwright/test").PlaywrightWorkerOptions & E2eOptions & {
  app: E2eApp;
}>;
/** Where opening the app lands: the app itself, or plan selection for a store with no plan. */
export type AppLanding = {
  readonly _tag: "App";
  readonly frame: FrameLocator;
} | {
  readonly _tag: "PlanSelection";
};
/**
 * Opens the app in the store's admin (`baseURL` + `path`) and waits for where it lands: the app's
 * frame showing `ready` (a locator inside it), hydrated, with the Dev Console collapsed; or
 * {@link planSelectionUrl}, where the merchant gate sends a store with no plan. It navigates with
 * `waitUntil: "commit"`, because the admin redirects at once to re-run the embed handshake.
 */
export declare const openApp: (page: Page, app: E2eApp, ready: (frame: FrameLocator) => Locator, path?: string) => Promise<AppLanding>;
export { expect$1 as expect, test$1 as test };