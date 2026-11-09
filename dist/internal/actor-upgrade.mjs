import { ShopDomain } from "./domain.mjs";
import { CONNECTION_CLOSE_FORBIDDEN, CONNECTION_CLOSE_NOT_A_MEMBER, CONNECTION_CLOSE_PAYMENT_REQUIRED, CONNECTION_CLOSE_TRY_AGAIN, CONNECTION_CLOSE_UNAUTHENTICATED, CONNECTION_CLOSE_UNINSTALLED, CONNECTION_HEADER, MerchantCaller } from "./shop-actor-contract.mjs";
import { MerchantGate } from "./merchant-gate.mjs";
import { refusedUpgrade } from "./actor-socket.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Match from "effect/Match";
// src/internal/actor-upgrade.ts
/** `/api/actor/<shop>` ({@link ACTOR_PATH}) split on `/`, optionally with a trailing slash. */
const ActorPath = Schema.Union([Schema.Tuple([
	Schema.Literal(""),
	Schema.Literal("api"),
	Schema.Literal("actor"),
	ShopDomain
]), Schema.Tuple([
	Schema.Literal(""),
	Schema.Literal("api"),
	Schema.Literal("actor"),
	ShopDomain,
	Schema.Literal("")
])]);
const decodeActorPath = Schema.decodeUnknownOption(ActorPath);
/** The shop of an {@link ActorPath}; None for any other path. A tuple rejects extra segments. */
const actorKeyFromPath = (pathname) => Option.map(decodeActorPath(pathname.split("/")), (segments) => segments[3]);
/** Whether a path is addressed to an actor at all, so one that names no shop is 404. */
const isActorPath = (pathname) => pathname === "/api/actor" || pathname.startsWith(`/api/actor/`);
/** The headers a WebSocket handshake itself needs: the only ones a forwarded upgrade keeps. */
const FORWARDED_HANDSHAKE_HEADERS = [
	"upgrade",
	"connection",
	"sec-websocket-key",
	"sec-websocket-version",
	"sec-websocket-protocol",
	"sec-websocket-extensions"
];
const encodeMerchantHeader = Schema.encodeSync(Schema.fromJsonString(MerchantCaller));
/**
* The upgrade the actor sees: rebuilt from nothing but the handshake headers and
* {@link CONNECTION_HEADER} naming the caller as JSON. The merchant's `?token=`, the cookie and
* any incoming `x-actor-*` header never reach the actor, so a browser cannot name itself.
*/
const forwardedUpgrade = (request, pathname, connection) => {
	const headers = new Headers();
	for (const name of FORWARDED_HANDSHAKE_HEADERS) {
		const value = request.headers[name];
		if (value !== void 0) headers.set(name, value);
	}
	headers.set(CONNECTION_HEADER, connection);
	return HttpServerRequest.fromWeb(new Request(new URL(pathname, "http://backend"), {
		method: "GET",
		headers
	}));
};
/** The gate's refusal as the close code the browser reads, with a short reason. */
const refusalClose = (status) => Match.value(status).pipe(Match.when(401, () => ({
	code: CONNECTION_CLOSE_UNAUTHENTICATED,
	reason: "unauthenticated"
})), Match.when(402, () => ({
	code: CONNECTION_CLOSE_PAYMENT_REQUIRED,
	reason: "payment required"
})), Match.when(403, () => ({
	code: CONNECTION_CLOSE_FORBIDDEN,
	reason: "forbidden"
})), Match.when(404, () => ({
	code: CONNECTION_CLOSE_NOT_A_MEMBER,
	reason: "not a member"
})), Match.when(410, () => ({
	code: CONNECTION_CLOSE_UNINSTALLED,
	reason: "uninstalled"
})), Match.when(503, () => ({
	code: CONNECTION_CLOSE_TRY_AGAIN,
	reason: "try again"
})), Match.exhaustive);
const isUpgrade = (request) => request.method === "GET" && request.headers.upgrade?.toLowerCase() === "websocket";
/**
* The merchant gate, {@link actorUpgrade}'s default. The merchant's Shopify ID token arrives as
* `?token=`, because a browser cannot set a header on an upgrade. The gate verifies it (never
* exchanges it: the `/app` guard did), checks its shop is the socket's before any read, and
* requires an active plan. A D1 failure and a plan that could not be read are both 503, so an
* outage never reads as "uninstalled" and the browser retries.
*/
const merchantGate = Effect.gen(function* () {
	const gate = yield* MerchantGate;
	return Effect.fn("Backend.merchantGate")(function* (key, request) {
		const token = new URL(request.url, "http://backend").searchParams.get("token");
		if (token === null) return yield* Effect.fail(401);
		if ((yield* gate.verifiedShop(token).pipe(Effect.catchTag("InvalidIdTokenError", () => Effect.fail(401)))) !== key) return yield* Effect.fail(403);
		if ((yield* gate.merchantStanding(token).pipe(Effect.catchTags({
			InvalidIdTokenError: () => Effect.fail(401),
			AppNotInstalledError: () => Effect.fail(410),
			ShopifyUnavailableError: (error) => Effect.logError(`Backend.merchantGate: shop=${key}: plan resolution failed`, Cause.fail(error)).pipe(Effect.annotateLogs({ shop: key }), Effect.andThen(Effect.fail(503)))
		}))).status._tag === "Unsubscribed") return yield* Effect.fail(402);
		return encodeMerchantHeader({ role: "merchant" });
	}, (effect, key) => effect.pipe(Effect.catchDefect((defect) => Effect.logError(`Backend.merchantGate: shop=${key}: lookup failed`, Cause.die(defect)).pipe(Effect.annotateLogs({ shop: key }), Effect.andThen(Effect.fail(503))))));
});
/**
* The Backend's `fetch` branch for {@link isActorPath}, over the app's `ShopActor` binding:
*
* ```ts
* const upgrade = yield* actorUpgrade(ShopActor);
* if (isActorPath(pathname)) return yield* upgrade(request);
* ```
*
* A path that names no shop is 404, anything but a WebSocket upgrade 426: there is no HTTP RPC
* into the actor. `gate` admits the upgrade, {@link merchantGate} by default; an app with other
* roles passes its own. A refusal is a socket closed at once with its {@link refusalClose} code.
*/
const actorUpgrade = Effect.fn("actorUpgrade")(function* (actor, options) {
	const actors = yield* actor;
	const gate = yield* options?.gate ?? merchantGate;
	const forwardToActor = Effect.fn("Backend.forwardToActor")(function* (key, request) {
		if (!isUpgrade(request)) return HttpServerResponse.empty({
			status: 426,
			headers: { upgrade: "websocket" }
		});
		const connection = yield* gate(key, request).pipe(Effect.result);
		if (connection._tag === "Failure") {
			const { code, reason } = refusalClose(connection.failure);
			yield* Effect.logDebug(`Backend.forwardToActor: shop=${key} code=${String(code)}: refused`).pipe(Effect.annotateLogs({
				shop: key,
				code
			}));
			return yield* refusedUpgrade(code, reason);
		}
		const { pathname } = new URL(request.url, "http://backend");
		return yield* actors.getByName(key).fetch(forwardedUpgrade(request, pathname, connection.success));
	});
	return (request) => Option.match(actorKeyFromPath(new URL(request.url, "http://backend").pathname), {
		onNone: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
		onSome: (key) => forwardToActor(key, request)
	});
});
export { actorKeyFromPath, actorUpgrade, forwardedUpgrade, isActorPath, merchantGate, refusalClose };
