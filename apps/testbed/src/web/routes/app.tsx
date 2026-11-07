import { APP_BRIDGE_URL } from "@mw10013/shopify-app-workers/website";
import { createFileRoute } from "@tanstack/react-router";

import { getApiKey } from "#web/server/shopify.ts";

/** The embedded App Home, which the Shopify admin frames. App Bridge is its first script. */
export const Route = createFileRoute("/app")({
  loader: () => getApiKey(),
  head: ({ loaderData }) => ({
    meta: [{ name: "shopify-api-key", content: loaderData?.apiKey }],
    scripts: [{ src: APP_BRIDGE_URL }],
  }),
  component: AppHome,
});

function AppHome() {
  return (
    <s-page heading="Workers Testbed">
      <s-section accessibilityLabel="Workers Testbed">
        <s-paragraph>The testbed is running.</s-paragraph>
      </s-section>
    </s-page>
  );
}
