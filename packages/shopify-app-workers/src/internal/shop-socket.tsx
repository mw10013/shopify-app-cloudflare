/**
 * The page's socket to its shop's actor, and the banners that show what the page has lost.
 *
 * @module
 */

import { RegistryContext, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useHydrated, useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import type * as Atom from "effect/reactivity/Atom";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";

import {
  lostAtom,
  reaskAtom,
  reconnectAtom,
  type SocketState,
  socketStateAtom,
} from "./actor-connection.ts";
import { mintIdToken } from "./app-bridge.ts";
import type { ShopDomain } from "./domain.ts";
import { reloadFromServer, rereadFailedAtom } from "./live-route.ts";
import { forgetAppGuard } from "./merchant-request.ts";
import { nameSocket } from "./shop-actor-client.ts";
import {
  CONNECTION_CLOSE_DISPLACED,
  CONNECTION_CLOSE_UNAUTHENTICATED,
  CONNECTION_CLOSE_UNINSTALLED,
} from "./shop-actor-contract.ts";

/** What {@link SocketBanner} shows: its tone, its heading, and whether it offers Reconnect. */
export interface BannerCopy {
  readonly tone: "warning" | "critical";
  readonly heading: string;
  readonly reconnect: boolean;
}

/**
 * The banner for the socket's state, if any. A stop that ended the socket for good, the uninstall
 * or a merchant's Shopify token the gate no longer accepts, is critical, with no Reconnect. A
 * member's 4401 is not: their session is the route's to judge, and its guard sends them to
 * sign-in when it is gone. `lost` is the grace `lostAtom` waits out before the page says so.
 */
export const bannerCopy = (
  socket: SocketState,
  options: { readonly appName: string; readonly merchant: boolean; readonly lost: boolean },
): Option.Option<BannerCopy> => {
  const { appName, merchant, lost } = options;
  if (typeof socket === "object") {
    if (socket.stopped === CONNECTION_CLOSE_DISPLACED)
      return Option.some({
        tone: "warning",
        heading: "Signed in elsewhere. Reconnect to keep working here.",
        reconnect: true,
      });
    if (socket.stopped === CONNECTION_CLOSE_UNINSTALLED)
      return Option.some({
        tone: "critical",
        heading: `${appName} was uninstalled from this store.`,
        reconnect: false,
      });
    if (merchant && socket.stopped === CONNECTION_CLOSE_UNAUTHENTICATED)
      return Option.some({
        tone: "critical",
        heading: "Your Shopify session expired.",
        reconnect: false,
      });
    return Option.some({
      tone: "warning",
      heading: `${appName} stopped updating this page. Reconnect to try again.`,
      reconnect: true,
    });
  }
  if (socket === "lost" && lost)
    return Option.some({
      tone: "warning",
      heading: `${appName} lost its connection. This page won't update, and you can't make changes until it reconnects.`,
      reconnect: false,
    });
  return Option.none();
};

/**
 * The one place the shop socket's health shows, rendered by {@link ShopSocket} above every page it
 * holds the socket for. Nothing while the socket is healthy, because connected is the expected
 * state and a permanent badge trains people to ignore the one moment it matters. Displaced (a
 * newer window took a member's last socket) with Reconnect, because the socket will not come back
 * on its own; Reconnect opens a new socket, which displaces the other window in its turn. Lost
 * only after `lostAtom`'s grace, since every load and reconnect starts down and settles well
 * inside it, and a banner that flashes on each navigation is one people learn to skip; its copy
 * says what being down costs.
 *
 * Each sentence is the banner's `heading`: Polaris puts `role="alert"` on an element inside its
 * shadow root, and only the heading is rendered inside it.
 */
export function SocketBanner({
  appName,
  merchant = true,
}: {
  readonly appName: string;
  readonly merchant?: boolean;
}) {
  const socket = useAtomValue(socketStateAtom);
  const lost = useAtomValue(lostAtom);
  const reconnect = useAtomSet(reconnectAtom);
  return Option.match(bannerCopy(socket, { appName, merchant, lost }), {
    onNone: () => null,
    onSome: (copy) => (
      <s-banner tone={copy.tone} heading={copy.heading}>
        {copy.reconnect && (
          <s-button
            slot="secondary-actions"
            variant="secondary"
            onClick={() => {
              reconnect((n) => n + 1);
            }}
          >
            Reconnect
          </s-button>
        )}
      </s-banner>
    ),
  });
}

/** The banner while `route` shows its last answer because a reread failed (`keepLastAnswer`). */
export function RereadFailedBanner({
  appName,
  route,
}: {
  readonly appName: string;
  readonly route: string;
}) {
  if (!useAtomValue(rereadFailedAtom(route))) return null;
  return (
    <s-banner tone="warning">{`${appName} couldn't refresh this page, so it may be out of date.`}</s-banner>
  );
}

interface SocketProps {
  readonly shop: ShopDomain;
  /** The app's `makeNoticesAtom(Client.runtime)`. */
  readonly notices: Atom.Atom<unknown>;
  readonly appName: string;
}

/**
 * Reruns the router's guards and loaders on each {@link reaskAtom}, asking the Backend rather
 * than any remembered answer.
 */
function useReask() {
  const reask = useAtomValue(reaskAtom);
  const registry = useContext(RegistryContext);
  const router = useRouter();
  const seen = useRef(reask);
  useEffect(() => {
    if (reask === seen.current) return;
    seen.current = reask;
    forgetAppGuard(registry);
    void reloadFromServer(registry, router);
  }, [reask, registry, router]);
}

/**
 * The holder once hydrated: names the socket once, keeps it open, shows its banner. Rendered
 * before the pages, its siblings, so the socket is named before any page reads an atom.
 */
function LiveShopSocket({ shop, notices, appName }: SocketProps) {
  const registry = useContext(RegistryContext);
  // oxlint-disable-next-line react/hook-use-state -- a lazy initializer that runs once on the first render; there is no state
  useState(() => {
    nameSocket(registry, shop, mintIdToken);
  });
  useAtomMount(notices);
  useReask();
  return <SocketBanner appName={appName} />;
}

/**
 * The shop socket's holder: one socket per tab, held by the `/app` layout. It names the socket
 * once per shop, with an App Bridge ID token minted per connect, and keeps `notices` mounted for
 * as long as the layout is, which keeps the client's runtime and so the socket alive across the
 * pages under it; a page never names it. It renders {@link SocketBanner} above its children.
 * Before hydration it renders its children alone, so no socket is built on the server; the
 * children keep their place in the tree when it hydrates.
 *
 * There is no keepalive ping or stale-socket watchdog here, on purpose: Effect's RPC client
 * pings every five seconds and drops and reconnects a socket that misses a pong, and Alchemy's
 * `RpcWebSocket` answers that ping at the edge with the WebSocket auto-response, without waking
 * the actor.
 *
 * @see refs/effect/packages/effect/src/rpc/RpcClient.ts (`makePinger`)
 * @see refs/alchemy/packages/alchemy/src/Cloudflare/Workers/RpcWebSocket.ts (`make`)
 */
export function ShopSocket(props: SocketProps & { readonly children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <>
      {hydrated && (
        <LiveShopSocket
          key={props.shop}
          shop={props.shop}
          notices={props.notices}
          appName={props.appName}
        />
      )}
      {props.children}
    </>
  );
}
