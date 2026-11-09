import { POLARIS_URL } from "@mw10013/shopify-app-workers/website";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useHydrated,
} from "@tanstack/react-router";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { ReactNode } from "react";

/**
 * The document every page renders in. Polaris loads in `<head>`, after {@link HeadContent}, so a
 * route's own head script, such as App Bridge, which must be the document's first script, stays
 * ahead of it.
 *
 * Until React has hydrated, the server markup is painted but dead, so `inert` on `<body>` blocks
 * input for that window and `data-hydrated` marks its end.
 */
function RootDocument({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    // Polaris adds its theme class to `<html>` as it loads, before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script src={POLARIS_URL} />
      </head>
      <body inert={!hydrated} data-hydrated={hydrated ? "" : undefined}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRouteWithContext<{
  readonly registry: AtomRegistry.AtomRegistry;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Workers Testbed" },
    ],
  }),
  shellComponent: RootDocument,
});
