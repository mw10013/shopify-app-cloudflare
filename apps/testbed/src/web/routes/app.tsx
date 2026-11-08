import { ShopifyUnavailableError } from "@mw10013/shopify-app-workers/contract";
import { APP_BRIDGE_URL } from "@mw10013/shopify-app-workers/website";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

import { appSearch, documentHeaders } from "#web/server/shopify-urls.ts";
import {
  authenticateApp,
  documentHasBearer,
  getAppHome,
  getShopifyApp,
} from "#web/server/shopify.ts";

import {
  type AppGuardReads,
  documentGuard,
  type GuardInput,
  navigationGuard,
} from "./-app-guard.ts";

const reads: AppGuardReads = { getShopifyApp, authenticateApp, documentHasBearer };

/** The document's guard during SSR, the navigation guard in the browser. */
const appGuard = createIsomorphicFn()
  .server((input: GuardInput) => documentGuard(reads)(input))
  .client(() => navigationGuard(reads)());

/**
 * The embedded App Home, which the Shopify admin frames. `beforeLoad` is the merchant gate
 * (`BACKEND.authenticateMerchant`); the loader is its screen read (`BACKEND.appHome`). App Bridge
 * is the document's first script.
 */
export const Route = createFileRoute("/app")({
  beforeLoad: ({ location }) => appGuard({ location }),
  loader: ({ location }) =>
    getAppHome({ data: { idToken: appSearch(location.searchStr).id_token } }),
  head: ({ match }) => ({
    meta: [{ name: "shopify-api-key", content: match.context.apiKey }],
    scripts: [{ src: APP_BRIDGE_URL }],
  }),
  headers: ({ match }) => documentHeaders(match.context.shop),
  component: AppHome,
  errorComponent: AppError,
});

/** The App Home: the shop, its plan's handle and the install instant, each for the e2e suite to read. */
function AppHome() {
  const { shop, planHandle, installedAt } = Route.useLoaderData();
  return (
    <s-page heading="Workers Testbed">
      <s-section heading="App installation">
        <s-stack gap="small">
          <s-paragraph>
            Shop: <span data-testid="shop">{shop}</span>
          </s-paragraph>
          <s-paragraph>
            Plan: <span data-testid="plan-handle">{planHandle}</span>
          </s-paragraph>
          <s-paragraph>
            Installed: <span data-testid="installed-at">{installedAt ?? "unknown"}</span>
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

const isShopifyUnavailable = Schema.is(ShopifyUnavailableError);

function AppError({ error }: ErrorComponentProps) {
  if (isShopifyUnavailable(error))
    return (
      <s-page heading="Shopify isn't responding" inlineSize="small">
        <s-section accessibilityLabel="Shopify isn't responding">
          <s-stack gap="base">
            <s-paragraph>Try again in a moment.</s-paragraph>
            <s-button
              onClick={() => {
                window.location.reload();
              }}
            >
              Try again
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  // Opening the app again from the Shopify admin embeds it with a fresh ID token, which mends a
  // token the Backend refused and retries anything else.
  return (
    <s-page heading="Workers Testbed couldn't load this page" inlineSize="small">
      <s-section accessibilityLabel="Workers Testbed couldn't load this page">
        <s-paragraph>Open Workers Testbed again from Apps in the Shopify admin.</s-paragraph>
      </s-section>
    </s-page>
  );
}
