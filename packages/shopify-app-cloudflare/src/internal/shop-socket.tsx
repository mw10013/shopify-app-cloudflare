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

export interface BannerCopy {
  readonly tone: "warning" | "critical";
  readonly heading: string;
  readonly reconnect: boolean;
}

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

/**
 * How the socket's upgrade is named: `merchant`, a Shopify ID token minted from App Bridge per
 * connect; `cookie`, the session cookie the browser sends, for a team member outside the admin.
 */
export type SocketCredential = "merchant" | "cookie";

interface SocketProps {
  readonly shop: ShopDomain;
  /** The app's `makeNoticesAtom(Client.runtime)`. */
  readonly notices: Atom.Atom<unknown>;
  readonly appName: string;
  /** `merchant` unless given. */
  readonly credential?: SocketCredential | undefined;
}

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

function LiveShopSocket({ shop, notices, appName, credential = "merchant" }: SocketProps) {
  const registry = useContext(RegistryContext);
  const merchant = credential === "merchant";
  // oxlint-disable-next-line react/hook-use-state -- a lazy initializer that runs once on the first render; there is no state
  useState(() => {
    nameSocket(registry, shop, merchant ? mintIdToken : undefined);
  });
  useAtomMount(notices);
  useReask();
  return <SocketBanner appName={appName} merchant={merchant} />;
}

/**
 * The shop socket's holder: one socket per tab, held by the layout. It names the socket once per
 * shop and {@link SocketCredential}, and keeps `notices` mounted for as long as the layout is,
 * which keeps the client's runtime and so the socket alive across the pages under it; a page
 * never names it. It renders {@link SocketBanner} above its children.
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
          key={`${props.shop} ${props.credential ?? "merchant"}`}
          shop={props.shop}
          notices={props.notices}
          appName={props.appName}
          credential={props.credential}
        />
      )}
      {props.children}
    </>
  );
}
