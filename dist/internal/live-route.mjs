import { socketStateAtom } from "./actor-connection.mjs";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Atom from "effect/reactivity/Atom";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Result from "effect/Result";
// src/internal/live-route.ts
/**
* Live routes: a route names its notice keys in `staticData.live`, a notice naming one reruns its
* loader, a loader reads over the actor socket while it is open, and a failed reread keeps the
* last answer.
*
* @module
*/
/** The socket failed to carry the read (`RpcClientError`): the server function can still answer. */
const transportFailed = (cause) => Result.match(Cause.findError(cause), {
	onSuccess: (error) => Predicate.isTagged(error, "RpcClientError"),
	onFailure: () => false
});
var ReadUnavailableError = class extends Data.TaggedError("ReadUnavailableError") {};
const readServer = (server) => server().catch((error) => {
	if (isRedirect(error) || isNotFound(error) || error instanceof ReadUnavailableError) throw error;
	throw new ReadUnavailableError({ cause: error });
});
const procedureFailed = (cause) => Result.isSuccess(Cause.findError(cause));
const serverReloads = Atom.make(0).pipe(Atom.keepAlive);
const readsFromServer = (registry) => registry.get(serverReloads) > 0;
/**
* `router.invalidate()` for a caller that wants the server's answer, not the socket's (a refused
* socket): every live loader it reruns reads through the Backend. Not a loader's `cause`: the
* router calls a match `stay` whenever the same route holds the same place in the tree, so a
* filter or a page change is a `stay` too.
*/
const reloadFromServer = async (registry, router) => {
	registry.set(serverReloads, registry.get(serverReloads) + 1);
	try {
		await router.invalidate();
	} finally {
		registry.set(serverReloads, registry.get(serverReloads) - 1);
	}
};
const lastAnswers = /* @__PURE__ */ new WeakMap();
/** True while `route` shows its last answer because a reread failed ({@link keepLastAnswer}). */
const rereadFailedAtom = Atom.family((_route) => Atom.make(false).pipe(Atom.keepAlive));
/**
* A live loader's answer, kept per route and request. When a read of the request the route last
* answered fails without a refusal, the route keeps that answer and {@link rereadFailedAtom} says
* so, instead of the error page replacing a page the merchant may be working in; the next notice
* reads again. A refusal, a procedure's own failure, or a failed read of another request throws.
*/
const keepLastAnswer = async (registry, at, read) => {
	const routes = lastAnswers.get(registry) ?? /* @__PURE__ */ new Map();
	lastAnswers.set(registry, routes);
	const entry = routes.get(at.route);
	const last = entry?.request === at.request ? Option.some(entry.answer) : Option.none();
	try {
		const answer = await read(last);
		routes.set(at.route, {
			request: at.request,
			answer
		});
		registry.set(rereadFailedAtom(at.route), false);
		return answer;
	} catch (error) {
		if (!(error instanceof ReadUnavailableError)) throw error;
		if (Option.isNone(last)) throw error.cause;
		registry.set(rereadFailedAtom(at.route), true);
		return last.value;
	}
};
/**
* The live reads over the app's actor client. `readLive` on the server calls the server function.
* In the browser it reads over the actor socket while the socket is open, and over the server
* function otherwise; it never waits for a socket, and neither read is ever interrupted.
*
* `readLiveAnswer` is for a loader whose server answer holds more than its socket read: the first
* read of a request, and every `fresh` one, goes through the server function, and later ones read
* the live part over the socket into the last answer ({@link keepLastAnswer}).
*
* `onServer` defaults to there being no `document`.
*/
const makeLiveReads = (client, options = {}) => {
	const onServer = options.onServer ?? typeof document === "undefined";
	const readLive = async (registry, read) => {
		if (onServer) return read.server();
		if (registry.get(socketStateAtom) !== "open" || readsFromServer(registry)) return readServer(read.server);
		const exit = await Effect.runPromiseExit(AtomRegistry.getResult(registry, client.runtime, { suspendOnWaiting: true }).pipe(Effect.flatMap((context) => read.socket(Context.get(context, client)))));
		if (Exit.isSuccess(exit)) return exit.value;
		if (transportFailed(exit.cause)) return readServer(read.server);
		if (procedureFailed(exit.cause)) throw Cause.squash(exit.cause);
		throw new ReadUnavailableError({ cause: Cause.squash(exit.cause) });
	};
	const readLiveAnswer = (registry, read) => keepLastAnswer(registry, read, (last) => Option.match(read.fresh === true ? Option.none() : last, {
		onNone: () => readServer(read.server),
		onSome: (answer) => readLive(registry, {
			server: read.server,
			socket: (service) => read.socket(service, answer)
		})
	}));
	return {
		readLive,
		readLiveAnswer
	};
};
/** A live route's `staleTime`: never stale by age, only when a notice names its keys. */
const STALE_ON_NOTICE_ONLY = Number.POSITIVE_INFINITY;
/**
* Runs `run` once the router is not loading. Each wait looks again after the `onResolved` emit
* has finished, not inside it: an earlier waiter may start a load there, and a waiter that
* subscribed again inside the emit would be called by the same emit, which walks a live `Set`,
* and again, without end.
*
* @see refs/tanstack-start/packages/router-core/src/router.ts (`emit`)
*/
const whenSettled = (router, run) => {
	if (router.state.status !== "pending") {
		run();
		return;
	}
	const stop = router.subscribe("onResolved", () => {
		stop();
		queueMicrotask(() => {
			whenSettled(router, run);
		});
	});
};
/**
* Reruns `routeId`'s loader now, resolving once its new data is in: for a write whose page must
* show its result before it moves on.
*/
const rereadRoute = (router, routeId) => new Promise((resolve) => {
	whenSettled(router, () => {
		router.invalidate({ filter: (match) => match.routeId === routeId }).finally(resolve);
	});
});
const readsAny = (match, keys) => (match.staticData.live ?? []).some((key) => keys.has(key));
/**
* Notice keys to `router.invalidate`, for the routes that declare them; the app sets it as
* `liveRoutesAtom` in the browser's registry. It never invalidates while the router is loading:
* `invalidate` would detach that load's reads, which still run at the actor, and pay for them
* twice. The keys are owed instead and replayed once that load resolves. A call no live match
* reads starts no load.
*/
const makeLiveRoutes = (router) => {
	const owed = /* @__PURE__ */ new Set();
	let waiting = false;
	const live = (keys) => [...router.state.matches, ...router._cache.values()].some((match) => readsAny(match, keys));
	const flush = () => {
		waiting = false;
		const keys = new Set(owed);
		owed.clear();
		if (keys.size === 0 || !live(keys)) return;
		router.invalidate({ filter: (match) => readsAny(match, keys) });
	};
	return { invalidate: (keys) => {
		for (const key of keys) owed.add(key);
		if (waiting) return;
		waiting = true;
		whenSettled(router, flush);
	} };
};
export { STALE_ON_NOTICE_ONLY, keepLastAnswer, makeLiveReads, makeLiveRoutes, reloadFromServer, rereadFailedAtom, rereadRoute };
