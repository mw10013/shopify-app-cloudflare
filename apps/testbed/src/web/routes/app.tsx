import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { socketStateAtom } from "@mw10013/shopify-app-workers/client";
import { ShopDomain, ShopifyUnavailableError } from "@mw10013/shopify-app-workers/contract";
import {
  APP_BRIDGE_URL,
  type AppGate,
  appGuard,
  appSearch,
  documentHeaders,
} from "@mw10013/shopify-app-workers/website";
import { RereadFailedBanner, ShopSocket } from "@mw10013/shopify-app-workers/website/react";
import {
  createFileRoute,
  type ErrorComponentProps,
  redirect,
  useHydrated,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useContext, useState } from "react";

import { COUNT_KEY } from "#contract/counter.ts";
import { noticesAtom, readLiveAnswer, ShopActorClient } from "#web/client/shop-actor.ts";
import {
  authenticateApp,
  documentHasBearer,
  getAppHome,
  getCount,
  getShopifyApp,
} from "#web/server/shopify.ts";

const APP_NAME = "Workers Testbed";

/**
 * The document's `id_token` for the loader during SSR. In the browser App Bridge's bearer carries
 * the token, so none rides in the GET server function's URL.
 */
const documentIdToken = createIsomorphicFn()
  .server((searchStr: string) => appSearch(searchStr).id_token)
  .client(() => undefined);

/**
 * The `/app` guard. Its type is written out because the route's own type would otherwise depend
 * on it through `redirect`, which reads the registered router.
 */
const gate: AppGate<Awaited<ReturnType<typeof authenticateApp>>> = appGuard({
  getShopifyApp,
  authenticateApp,
  documentHasBearer,
  redirect,
});

/**
 * The embedded App Home, which the Shopify admin frames. `beforeLoad` is the merchant gate
 * (`BACKEND.authenticateMerchant`); the loader is its screen read (`BACKEND.appHome`) and the
 * shop actor's count (`BACKEND.count`). A notice naming {@link COUNT_KEY} reads the count again,
 * over the socket into the last answer while it is open. App Bridge is the document's first
 * script.
 */
export const Route = createFileRoute("/app")({
  staticData: { live: [COUNT_KEY] },
  beforeLoad: gate.guard,
  loader: ({ location, context: { registry } }) => {
    const data = { idToken: documentIdToken(location.searchStr) };
    return readLiveAnswer(registry, {
      route: "/app",
      request: "",
      server: async () => {
        const [home, count] = await Promise.all([getAppHome({ data }), getCount({ data })]);
        return { ...home, count };
      },
      socket: (client, last) =>
        client("MerchantGetCount", undefined).pipe(Effect.map((count) => ({ ...last, count }))),
    });
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
  const { shop, apiKey, managePlanUrl } = Route.useRouteContext();
  const registry = useContext(RegistryContext);
  // oxlint-disable-next-line react/hook-use-state -- a lazy initializer that runs once on the first render; there is no state
  useState(() => {
    gate.rememberHydrated(registry, { shop, apiKey, managePlanUrl });
  });
  const { planHandle, installedAt, count } = Route.useLoaderData();
  const hydrated = useHydrated();
  return (
    <ShopSocket shop={decodeShopDomain(shop)} notices={noticesAtom} appName={APP_NAME}>
      <RereadFailedBanner appName={APP_NAME} route="/app" />
      <s-page heading={APP_NAME}>
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
          <SocketState />
        </div>
      </s-page>
    </ShopSocket>
  );
}

/** The actor socket's state, for the e2e suite to read. */
function SocketState() {
  const state = useAtomValue(socketStateAtom);
  return (
    <span data-testid="actor-socket">
      {typeof state === "string" ? state : `stopped:${String(state.stopped)}`}
    </span>
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
