import { ShopDomain } from "./domain.mjs";
import "./actor-connection.mjs";
import "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import { ReactNode } from "react";
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
export declare function SocketBanner({ appName, merchant }: {
  readonly appName: string;
  readonly merchant?: boolean;
}): import("react").JSX.Element | null;
/** The banner while `route` shows its last answer because a reread failed (`keepLastAnswer`). */
export declare function RereadFailedBanner({ appName, route }: {
  readonly appName: string;
  readonly route: string;
}): import("react").JSX.Element | null;
interface SocketProps {
  readonly shop: ShopDomain;
  /** The app's `makeNoticesAtom(Client.runtime)`. */
  readonly notices: Atom.Atom<unknown>;
  readonly appName: string;
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
export declare function ShopSocket(props: SocketProps & {
  readonly children: ReactNode;
}): import("react").JSX.Element;
export {};