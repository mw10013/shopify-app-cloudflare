import { createFileRoute } from "@tanstack/react-router";
import * as Option from "effect/Option";

import { appBridgePage } from "#web/server/app-bridge-page.ts";
import { env } from "#web/server/env.server.ts";
import { exitIframeDestination } from "#web/server/shopify-urls.ts";

/**
 * A string for a classic inline script: JSON with `<` escaped, because the HTML parser ends the
 * script at `</script>` before JavaScript sees the quotes.
 */
const inlineScriptString = (value: string) => JSON.stringify(value).replaceAll("<", String.raw`<`);

/**
 * The exit-iframe page: App Bridge, then the top window sent to `?exitIframe` (the app's URL when
 * absent), for a destination the Shopify admin cannot frame, such as plan selection
 * (`PlanUnsubscribedError`'s `href`). A destination {@link exitIframeDestination} refuses is
 * `400`, so the route is never an open redirect.
 */
export const Route = createFileRoute("/auth/exit-iframe")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const search = new URL(request.url).searchParams;
        return Option.match(
          exitIframeDestination(
            env.SHOPIFY_APP_URL,
            search.get("exitIframe") ?? env.SHOPIFY_APP_URL,
          ),
          {
            onNone: () =>
              new Response("Bad Request", {
                status: 400,
                headers: { "content-type": "text/plain" },
              }),
            onSome: (destination) =>
              appBridgePage(
                search.get("shop"),
                `<script>window.open(${inlineScriptString(destination.href)}, "_top")</script>`,
              ),
          },
        );
      },
    },
  },
});
