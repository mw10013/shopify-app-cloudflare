import { useAtomSet } from "@effect/atom-react";
import { ShopDomain, ShopifyUnavailableError } from "@mw10013/shopify-app-workers/contract";
import { APP_BRIDGE_URL } from "@mw10013/shopify-app-workers/website";
import { createFileRoute, type ErrorComponentProps, useHydrated } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { COUNT_KEY } from "#contract/counter.ts";
import { ShopActorClient } from "#web/client/shop-actor.ts";
import { ShopSocket } from "#web/components/ShopSocket.tsx";
import { appSearch, documentHeaders } from "#web/server/shopify-urls.ts";
import {
  authenticateApp,
  documentHasBearer,
  getAppHome,
  getCount,
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
/**
 * The document's `id_token` for the loader during SSR. In the browser App Bridge's bearer carries
 * the token, so none rides in the GET server function's URL.
 */
const documentIdToken = createIsomorphicFn()
  .server((searchStr: string) => appSearch(searchStr).id_token)
  .client(() => undefined);

const appGuard = createIsomorphicFn()
  .server((input: GuardInput) => documentGuard(reads)(input))
  .client(() => navigationGuard(reads)());

/**
 * The embedded App Home, which the Shopify admin frames. `beforeLoad` is the merchant gate
 * (`BACKEND.authenticateMerchant`); the loader is its screen read (`BACKEND.appHome`) and the
 * shop actor's count (`BACKEND.count`), read again whenever a notice names {@link COUNT_KEY}.
 * App Bridge is the document's first script.
 */
export const Route = createFileRoute("/app")({
  staticData: { live: [COUNT_KEY] },
  beforeLoad: ({ location }) => appGuard({ location }),
  loader: async ({ location }) => {
    const data = { idToken: documentIdToken(location.searchStr) };
    const [home, count] = await Promise.all([getAppHome({ data }), getCount({ data })]);
    return { ...home, count };
  },
  head: ({ match }) => ({
    meta: [{ name: "shopify-api-key", content: match.context.apiKey }],
    scripts: [{ src: APP_BRIDGE_URL }],
  }),
  headers: ({ match }) => documentHeaders(match.context.shop),
  component: AppHome,
  errorComponent: AppError,
});

/**
 * The App Home: the shop's count with its Increment button, and, for the e2e suite to read, the
 * shop, its plan's handle, the install instant and the actor socket's state.
 */
function AppHome() {
  const { shop, planHandle, installedAt, count } = Route.useLoaderData();
  const hydrated = useHydrated();
  return (
    <s-page heading="Workers Testbed">
      <s-section heading="Counter">
        <s-stack gap="base">
          <s-paragraph>
            Count: <span data-testid="count">{count}</span>
          </s-paragraph>
          {hydrated ? <IncrementButton /> : <s-button disabled>Increment</s-button>}
        </s-stack>
      </s-section>
      {/* Read only by the e2e suites; merchants never see them. */}
      <div hidden>
        <span data-testid="shop">{shop}</span>
        <span data-testid="plan-handle">{planHandle}</span>
        <span data-testid="installed-at">{installedAt ?? "unknown"}</span>
        <ShopSocket shop={decodeShopDomain(shop)} />
      </div>
    </s-page>
  );
}

const decodeShopDomain = Schema.decodeUnknownSync(ShopDomain);

const incrementAtom = ShopActorClient.mutation("MerchantIncrement");

/**
 * `MerchantIncrement` over the page's socket. It shows no answer itself: the write's own notice
 * reruns the loader, which reads the new count.
 */
function IncrementButton() {
  const increment = useAtomSet(incrementAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  return (
    <s-button
      loading={pending}
      onClick={() => {
        setPending(true);
        void increment({ payload: undefined }).finally(() => {
          setPending(false);
        });
      }}
    >
      Increment
    </s-button>
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
