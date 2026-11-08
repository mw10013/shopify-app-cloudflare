import { E2eApp, E2ePlan } from "./app.mjs";
import { Locator, Page } from "playwright/test";
/** A Shopify screen the suite cannot get past by itself; its message says what the owner does. */
export declare class ShopifyScreenError extends Error {
  readonly name = "ShopifyScreenError";
}
/** The admin's own pages for the store. */
export declare const adminUrl: (app: E2eApp, path: string) => string;
/**
 * The admin install URL: Shopify's install page for an app the store lacks, else a redirect into
 * the app.
 */
export declare const installUrl: (app: E2eApp) => string;
/** Where the admin sends a store with no plan, and where a merchant changes plan. */
export declare const planSelectionUrl: (app: E2eApp) => string;
/**
 * Names the screen `page` shows when a wait for `expected` timed out: a page on another store than
 * the leased one is named by its store alone ({@link requireLeasedStore}); a lapsed login and
 * Shopify's connection check need the owner; anything else is quoted by its URL, title and first
 * heading, for the owner to look at in the agent Chrome.
 */
export declare const screenError: (page: Page, app: E2eApp, expected: string, cause?: unknown) => Promise<ShopifyScreenError>;
/**
 * Waits for `locator` on the leased store's admin, failing with the {@link screenError} for
 * `expected` when it never shows.
 */
export declare const awaitScreen: (page: Page, app: E2eApp, locator: Locator, expected: string, timeout?: number) => Promise<void>;
/** Where opening the install URL or the app lands. */
export type AdminLanding = {
  readonly _tag: "Installing";
} | {
  readonly _tag: "App";
} | {
  readonly _tag: "PlanSelection";
} |
/** The app's frame loads its released URL: the store has the app, but no dev preview of it. */
{
  readonly _tag: "DevPreviewEnded";
  readonly src: string;
};
/**
 * One wait over the screens opening the app can land on, each read as soon as it shows: Shopify's
 * install page, plan selection, or the app's frame, which loads the tunnel when the CLI's dev
 * preview serves the store and the app's released URL when none does.
 */
export declare const awaitLanding: (page: Page, app: E2eApp) => Promise<AdminLanding>;
/** Clicks Install on Shopify's install page and waits to leave it. */
export declare const approveInstall: (page: Page, app: E2eApp) => Promise<void>;
/**
 * Subscribes the store to `plan` through Shopify's plan selection page, approving the test
 * charge, and waits for Shopify to send the merchant back into the app. Answers `false`, changing
 * nothing, when the page already marks `plan` "Current". A plan card offers no button for the
 * current plan.
 */
export declare const choosePlan: (page: Page, app: E2eApp, plan: E2ePlan) => Promise<boolean>;
/**
 * Uninstalls the app through Settings > Apps: the app's row, its Uninstall app button, and the
 * dialog, which enables Uninstall only once a reason is ticked. The reasons open in a popover over
 * the dialog's buttons, closed by a click on the dialog's heading.
 */
export declare const uninstall: (page: Page, app: E2eApp) => Promise<void>;
/**
 * Restarts the e2e server with the app's {@link E2eApp} `restart` command and answers the app on
 * the new server.
 */
export declare const restartServer: (app: E2eApp) => Promise<E2eApp>;