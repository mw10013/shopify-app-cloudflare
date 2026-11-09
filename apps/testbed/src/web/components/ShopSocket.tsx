import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react";
import { nameSocket, reaskAtom, socketStateAtom } from "@mw10013/shopify-app-workers/client";
import type { ShopDomain } from "@mw10013/shopify-app-workers/contract";
import { useHydrated, useRouter } from "@tanstack/react-router";
import { useContext, useEffect, useRef, useState } from "react";

import { mintIdToken, noticesAtom } from "#web/client/shop-actor.ts";

/**
 * The holder once hydrated: names the socket once, keeps it open, and reruns the router's
 * guard and loader on each stop ({@link reaskAtom}).
 */
function LiveShopSocket({ shop }: { readonly shop: ShopDomain }) {
  const registry = useContext(RegistryContext);
  // oxlint-disable-next-line react/hook-use-state -- a lazy initializer that runs once on the first render; there is no state
  useState(() => {
    nameSocket(registry, shop, mintIdToken);
  });
  useAtomMount(noticesAtom);
  const router = useRouter();
  const reask = useAtomValue(reaskAtom);
  const seen = useRef(reask);
  useEffect(() => {
    if (reask === seen.current) return;
    seen.current = reask;
    void router.invalidate();
  }, [reask, router]);
  const state = useAtomValue(socketStateAtom);
  return (
    <span data-testid="actor-socket">
      {typeof state === "string" ? state : `stopped:${String(state.stopped)}`}
    </span>
  );
}

/**
 * The page's one socket to its shop's actor. Before hydration it renders nothing, so no socket is
 * built on the server. Its state is for the e2e suite only, so the caller renders it hidden.
 */
export function ShopSocket({ shop }: { readonly shop: ShopDomain }) {
  const hydrated = useHydrated();
  return hydrated ? <LiveShopSocket key={shop} shop={shop} /> : null;
}
