import { RegistryContext, scheduleTask } from "@effect/atom-react";
import { liveRoutesAtom } from "@mw10013/shopify-app-workers/client";
import { makeLiveRoutes } from "@mw10013/shopify-app-workers/website/react";
import { createRouter } from "@tanstack/react-router";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { StrictMode } from "react";

import { routeTree } from "./routeTree.gen";

/**
 * Builds the router and its atom registry, once per request on the server and once in the
 * browser, so the actor socket's atoms and the guard's remembered answer never cross between
 * requests. Only the browser's router hears notices ({@link makeLiveRoutes}).
 */
export function getRouter() {
  const registry = AtomRegistry.make({ scheduleTask });
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    context: { registry },
    Wrap: ({ children }) => (
      <StrictMode>
        <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
      </StrictMode>
    ),
  });
  if (typeof document !== "undefined") registry.set(liveRoutesAtom, makeLiveRoutes(router));
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
