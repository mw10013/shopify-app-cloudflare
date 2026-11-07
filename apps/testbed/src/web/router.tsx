import { createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    Wrap: ({ children }) => <StrictMode>{children}</StrictMode>,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
