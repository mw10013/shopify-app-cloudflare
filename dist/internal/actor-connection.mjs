import { CONNECTION_CLOSE_REVOKED } from "./shop-actor-contract.mjs";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Match from "effect/Match";
import * as Atom from "effect/reactivity/Atom";
// src/internal/actor-connection.ts
/**
* The actor socket's state as the page shows it, and what each close code means for it.
*
* @module
*/
/**
* The shop whose actor this registry's client talks to; None until the socket holder names it
* (`nameSocket`), which it does before the page reads any socket atom. This and the other plain
* state atoms here are kept alive: they are set while nothing on the page reads them yet, and an
* unread atom would drop the value.
*/
const shopKeyAtom = Atom.make(Option.none()).pipe(Atom.keepAlive);
/**
* How the merchant's browser gets a Shopify ID token, run once per connect, so every reconnect
* carries a token minted for it. None for a socket the gate names from the session cookie, and
* until the socket holder names the socket.
*/
const merchantTokenAtom = Atom.make(Option.none()).pipe(Atom.keepAlive);
/** Bumped by each stop ({@link CloseOutcome}): the page asks the router again. */
const reaskAtom = Atom.make(0).pipe(Atom.keepAlive);
const socketStateAtom = Atom.make("connecting").pipe(Atom.keepAlive);
/** Bumped by the banner's Reconnect; the protocol reads it, so a bump rebuilds it. */
const reconnectAtom = Atom.make(0).pipe(Atom.keepAlive);
/** How long a lost socket stays quiet before the page says so; most reconnects are faster. */
const LOST_GRACE = Duration.seconds(4);
/** True once {@link socketStateAtom} has been `lost` for {@link LOST_GRACE}. */
const lostAtom = Atom.make((get) => {
	if (get(socketStateAtom) !== "lost") return false;
	const timer = setTimeout(() => {
		get.setSelf(true);
	}, Duration.toMillis(LOST_GRACE));
	get.addFinalizer(() => {
		clearTimeout(timer);
	});
	return false;
});
/** The 44xx closes: the gate's refusals, the actor's refusal of an unidentified socket, and its uninstall. */
const isRefusal = (code) => code >= 4400 && code < 4500;
const closeCode = (error) => error.reason._tag === "SocketCloseError" ? Option.some(error.reason.code) : Option.none();
const closeOutcome = (error) => Option.match(Option.filter(closeCode(error), isRefusal), {
	onNone: () => ({
		_tag: "Retry",
		reask: Option.contains(closeCode(error), CONNECTION_CLOSE_REVOKED)
	}),
	onSome: (code) => ({
		_tag: "Stop",
		code
	})
});
/**
* The socket's retry policy: exponential from 250 ms, capped at 4 s, until a stop
* ({@link CloseOutcome}). Every error the policy sees goes to `onError` first, which is how the
* page learns the close code.
*/
const retryPolicy = (onError) => Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("4 seconds")]).pipe(Schedule.setInputType(), Schedule.tap(({ input }) => onError(input)), Schedule.while(({ input }) => closeOutcome(input)._tag === "Retry"));
const applyCloseOutcome = (registry, outcome) => Effect.sync(() => {
	Match.value(outcome).pipe(Match.tagsExhaustive({
		Retry: ({ reask }) => {
			registry.set(socketStateAtom, "lost");
			if (reask) registry.update(reaskAtom, (n) => n + 1);
		},
		Stop: ({ code }) => {
			registry.set(socketStateAtom, { stopped: code });
			registry.update(reaskAtom, (n) => n + 1);
		}
	}));
});
export { applyCloseOutcome, closeOutcome, lostAtom, merchantTokenAtom, reaskAtom, reconnectAtom, retryPolicy, shopKeyAtom, socketStateAtom };
