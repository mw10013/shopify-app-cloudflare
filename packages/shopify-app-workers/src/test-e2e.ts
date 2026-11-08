/**
 * The end-to-end spec pack: Playwright specs that run against an app's long-lived e2e server and
 * its leased store, in the agent Chrome. An app registers it from its own `playwright.config.ts`
 * ({@link e2eProjects}, {@link E2E_PREFLIGHT}) and may add its own specs on the same
 * fixtures with {@link e2eProject}. Needs the optional peers `playwright`, `@mw10013/devkit` and `@effect/platform-node`.
 *
 * @module
 */

export { appFrame, awaitHydration, closeDevConsole } from "@mw10013/devkit/shopify/embedded-app";
export {
  E2E_PREFLIGHT,
  E2E_SPECS_DIR,
  E2E_TRACE,
  E2eApp,
  type E2eOptions,
  e2eProject,
  type E2eProjectSpecs,
  e2eProjects,
  SHOPIFY_ADMIN_PROJECT,
  SPEC_MATCH,
  shopOf,
} from "./test/e2e/app.ts";
export {
  type AppLanding,
  expect,
  openApp,
  planSelectionUrl,
  type ShopStatusRead,
  test,
} from "./test/e2e/fixtures.ts";
export {
  missingScopes,
  resultText,
  StoreAuthError,
  storeAuthMissing,
} from "./test/e2e/store-auth.ts";
