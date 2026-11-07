import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // The Shopify admin loads the app's root URL with `shop=`: an embedded launch, so on into the App
  // Home.
  beforeLoad: ({ location }) => {
    if (new URLSearchParams(location.searchStr).has("shop"))
      throw redirect({ href: `/app${location.searchStr}` });
  },
  component: () => <p>Workers Testbed</p>,
});
