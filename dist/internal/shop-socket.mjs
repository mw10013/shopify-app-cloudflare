import "./shop-actor-contract.mjs";
import { lostAtom, reaskAtom, reconnectAtom, socketStateAtom } from "./actor-connection.mjs";
import { nameSocket } from "./shop-actor-client.mjs";
import { reloadFromServer, rereadFailedAtom } from "./live-route.mjs";
import { mintIdToken } from "./app-bridge.mjs";
import { forgetAppGuard } from "./merchant-request.mjs";
import * as Option from "effect/Option";
import { useHydrated, useRouter } from "@tanstack/react-router";
import { RegistryContext, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
// src/internal/shop-socket.tsx
/**
* The page's socket to its shop's actor, and the banners that show what the page has lost.
*
* @module
*/
/**
* The banner for the socket's state, if any. A stop that ended the socket for good, the uninstall
* or a merchant's Shopify token the gate no longer accepts, is critical, with no Reconnect. A
* member's 4401 is not: their session is the route's to judge, and its guard sends them to
* sign-in when it is gone. `lost` is the grace `lostAtom` waits out before the page says so.
*/
const bannerCopy = (socket, options) => {
	const { appName, merchant, lost } = options;
	if (typeof socket === "object") {
		if (socket.stopped === 4409) return Option.some({
			tone: "warning",
			heading: "Signed in elsewhere. Reconnect to keep working here.",
			reconnect: true
		});
		if (socket.stopped === 4410) return Option.some({
			tone: "critical",
			heading: `${appName} was uninstalled from this store.`,
			reconnect: false
		});
		if (merchant && socket.stopped === 4401) return Option.some({
			tone: "critical",
			heading: "Your Shopify session expired.",
			reconnect: false
		});
		return Option.some({
			tone: "warning",
			heading: `${appName} stopped updating this page. Reconnect to try again.`,
			reconnect: true
		});
	}
	if (socket === "lost" && lost) return Option.some({
		tone: "warning",
		heading: `${appName} lost its connection. This page won't update, and you can't make changes until it reconnects.`,
		reconnect: false
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
function SocketBanner({ appName, merchant = true }) {
	const socket = useAtomValue(socketStateAtom);
	const lost = useAtomValue(lostAtom);
	const reconnect = useAtomSet(reconnectAtom);
	return Option.match(bannerCopy(socket, {
		appName,
		merchant,
		lost
	}), {
		onNone: () => null,
		onSome: (copy) => /* @__PURE__ */ jsx("s-banner", {
			tone: copy.tone,
			heading: copy.heading,
			children: copy.reconnect && /* @__PURE__ */ jsx("s-button", {
				slot: "secondary-actions",
				variant: "secondary",
				onClick: () => {
					reconnect((n) => n + 1);
				},
				children: "Reconnect"
			})
		})
	});
}
/** The banner while `route` shows its last answer because a reread failed (`keepLastAnswer`). */
function RereadFailedBanner({ appName, route }) {
	if (!useAtomValue(rereadFailedAtom(route))) return null;
	return /* @__PURE__ */ jsx("s-banner", {
		tone: "warning",
		children: `${appName} couldn't refresh this page, so it may be out of date.`
	});
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
		reloadFromServer(registry, router);
	}, [
		reask,
		registry,
		router
	]);
}
/**
* The holder once hydrated: names the socket once, keeps it open, shows its banner. Rendered
* before the pages, its siblings, so the socket is named before any page reads an atom.
*/
function LiveShopSocket({ shop, notices, appName, credential = "merchant" }) {
	const registry = useContext(RegistryContext);
	const merchant = credential === "merchant";
	useState(() => {
		nameSocket(registry, shop, merchant ? mintIdToken : void 0);
	});
	useAtomMount(notices);
	useReask();
	return /* @__PURE__ */ jsx(SocketBanner, {
		appName,
		merchant
	});
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
function ShopSocket(props) {
	const hydrated = useHydrated();
	return /* @__PURE__ */ jsxs(Fragment, { children: [hydrated && /* @__PURE__ */ jsx(LiveShopSocket, {
		shop: props.shop,
		notices: props.notices,
		appName: props.appName,
		credential: props.credential
	}, `${props.shop} ${props.credential ?? "merchant"}`), props.children] });
}
export { RereadFailedBanner, ShopSocket, SocketBanner, bannerCopy };
