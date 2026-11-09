import { ShopDomain } from "./domain.mjs";
import { CONNECTION_CLOSE_FORBIDDEN, CONNECTION_CLOSE_REVOKED, CONNECTION_CLOSE_UNINSTALLED, CONNECTION_HEADER, ConnectionMiddleware, CurrentCaller, ForbiddenError, MerchantCaller, NoticeFrame, RequireMerchant } from "./shop-actor-contract.mjs";
import { crossDefects, logDefect } from "./defects.mjs";
import { AppInstallations } from "./shopify-access.mjs";
import { ConnectionIdentity, DispatchingSocket, attachment, make as make$1, refusedUpgrade } from "./actor-socket.mjs";
import { syncTransaction } from "./transaction.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import * as SqlClient from "effect/sql/SqlClient";
// src/internal/shop-actor-kit.ts
/**
* `ShopActorKit`: the body of an app's shop actor, one Durable Object per shop named by its
* `ShopDomain`. The app declares the class and its procedures; the kit owns the lifecycle every
* app writes the same way.
*
* @module
*/
/**
* The reason `destroy` aborts the object with. The stub call it lands in rejects with an `Error`
* of this message, which is how `ShopActors.destroy` tells the abort from a failure.
*/
const ABORT_UNINSTALLED = "uninstalled";
/**
* What the actor's first activation dies with when the shop has no `AppInstallation`. It writes
* nothing, so `ShopActors.destroy` reads it as a store already empty: a shop whose actor never
* started, or a repeated uninstall. It dies inside the object's constructor, so the stub call
* rejects with it as a plain `Error` that keeps its own fields, `_tag` among them (measured in
* workerd 1.20261026.1, baton#75). `shop` is the object's name, or its id when it has none.
*/
var ShopNotInstalledError = class extends Schema.TaggedError()("ShopNotInstalledError", { shop: Schema.String }) {
	get message() {
		return `ShopActor.activate: shop=${this.shop}: no AppInstallation, not created`;
	}
};
/** The close reasons. A reason must stay under 123 bytes. */
const UNIDENTIFIED_REASON = "unidentified connection";
const UNINSTALLED_REASON = "uninstalled";
const PLAN_CHANGED_REASON = "plan changed";
/**
* How long `destroy` waits for the sockets it closed to finish their close handshake before it
* aborts. An abort drops a socket whose close frame has not gone out, and the browser then sees
* 1006, which it retries, instead of the terminal code.
*/
const CLOSE_HANDSHAKE_WAIT = "1 second";
const encodeNotice = Schema.encodeSync(NoticeFrame);
const decodeShopDomain = Schema.decodeUnknownOption(ShopDomain);
/**
* Whether the object has never been migrated: a shop's first activation, or the first after
* `destroy`, whose `deleteAll` removes the whole database. It looks for the migrator's own table,
* not for any table, because Cloudflare lists hidden tables of its own (`__cf_kv`).
*/
const isEmptyStore = (storage) => storage.sql.exec("select 1 from sqlite_master where type = 'table' and name = 'effect_sql_migrations'").toArray().length === 0;
const requireMerchantLayer = Layer.succeed(RequireMerchant)(RequireMerchant.of((effect) => Effect.gen(function* () {
	if ((yield* CurrentCaller).role !== "merchant") return yield* new ForbiddenError();
	return yield* effect;
})));
/**
* Reads the socket's identity, which `ActorSocket` provides around every dispatch. A message with
* none is a broken invariant, so it dies. Every defect is logged here, since `RpcServer` only
* sends it to the browser.
*/
const connectionMiddleware = (shop) => Layer.succeed(ConnectionMiddleware)(ConnectionMiddleware.of((effect, { rpc }) => Effect.gen(function* () {
	const identity = yield* Effect.serviceOption(ConnectionIdentity);
	if (Option.isNone(identity)) return yield* Effect.die(/* @__PURE__ */ new Error("a socket message without its identity"));
	const { caller, connectedAt } = identity.value;
	const at = DateTime.formatIso(connectedAt);
	yield* Effect.logDebug(`ShopActor.${rpc._tag}: shop=${shop} caller=${caller.role} connectedAt=${at}`).pipe(Effect.annotateLogs({
		shop,
		rpc: rpc._tag,
		caller: caller.role,
		connectedAt: at
	}));
	return yield* Effect.provideService(effect, CurrentCaller, caller);
}).pipe(logDefect(`ShopActor.${rpc._tag}: shop=${shop}`, { shop }), Effect.withSpan(`ShopActor.${rpc._tag}`))));
/**
* Builds a shop actor's implementation, for the app's `ShopActor.make`:
*
* ```ts
* export const ShopActorLive = ShopActor.make(
*   ShopActorKit.make({ rpcs: AppRpcs, migrations, build: ({ shop, sql, notify }) => ... }),
* );
* ```
*
* What the kit owns, per activation:
*
* - The name. An object reached by id (`idFromString`) has no name and serves only `destroy`; any
*   other call dies.
* - The guard on first activation. Any call creates the object it names, so with an empty store
*   (a new shop, or one `destroy` wiped) and no `AppInstallation` row the object refuses to start
*   with {@link ShopNotInstalledError} and writes nothing. An uninstalled shop's actor never
*   comes back.
* - The app's migrations, run inside the `blockConcurrencyWhile` Alchemy wraps construction in, so
*   no request sees a half-migrated store. The SQL client is rebuilt each activation.
* - `fetch`: only a WebSocket upgrade (else 426), whose caller is {@link CONNECTION_HEADER}; a
*   header that does not decode is accepted and closed with {@link CONNECTION_CLOSE_FORBIDDEN}.
* - `notify`, `destroy`, `revoke`, and the close log.
*
* The outer phase takes handles only: it runs at plan time against a mock state inside the
* Backend's init, which attaches every binding it yields to the Backend's script, and once per
* activation at runtime, where the services are the Backend's own instances.
*/
const make = (options) => Effect.gen(function* () {
	const state = yield* Cloudflare.DurableObjectState;
	const appInstallations = yield* AppInstallations;
	const services = yield* Effect.context();
	const callerSchema = options.caller ?? MerchantCaller;
	const decodeConnectionHeader = Schema.decodeUnknownOption(Schema.fromJsonString(callerSchema));
	const decodeAttachment = Schema.decodeUnknownOption(attachment(callerSchema));
	return Effect.gen(function* () {
		const name = decodeShopDomain(state.id.name);
		const label = Option.getOrElse(name, () => state.id.toString());
		const runtime = yield* Effect.context();
		if (isEmptyStore(state.raw.storage) && Option.isNone(yield* Option.match(name, {
			onNone: () => Effect.succeedNone,
			onSome: (shop) => appInstallations.find(shop)
		}))) {
			yield* Effect.logInfo(`ShopActor.activate: shop=${label}: no AppInstallation, not created`).pipe(Effect.annotateLogs({ shop: label }));
			return yield* Effect.die(new ShopNotInstalledError({ shop: label }));
		}
		const closeSocket = Effect.fn("ShopActor.closeSocket")(function* (ws, code, reason) {
			yield* ws.close(code, reason).pipe(Effect.catchDefect((defect) => Effect.logWarning(`ShopActor.closeSocket: shop=${label} code=${String(code)}: close failed`, Cause.die(defect)).pipe(Effect.annotateLogs({
				shop: label,
				code
			}))));
		});
		/**
		* Closes every socket with {@link CONNECTION_CLOSE_UNINSTALLED} (best effort), deletes the
		* alarm and then all storage, which ends the object's storage billing, syncs storage to
		* disk, waits up to {@link CLOSE_HANDSHAKE_WAIT} for the closes, and aborts with
		* {@link ABORT_UNINSTALLED}.
		*
		* SQLite-backed storage coalesces writes: `deleteAll` resolving does not mean the delete
		* reached disk, and a reset discards writes still coalescing, so it syncs before the abort.
		* Local workerd writes synchronously and never shows this. The abort matters because the
		* actor migrates once per activation: without it this activation would keep serving with its
		* tables gone. The abort lands mid-call, so the stub call rejects; `ShopActors.destroy` reads
		* that rejection as success.
		*/
		const destroy = Effect.fn("ShopActor.destroy")(function* () {
			const sockets = yield* state.getWebSockets();
			for (const ws of sockets) yield* closeSocket(ws, CONNECTION_CLOSE_UNINSTALLED, UNINSTALLED_REASON);
			yield* state.storage.deleteAlarm();
			yield* state.storage.deleteAll();
			yield* Effect.promise(() => state.raw.storage.sync());
			const closed = yield* Effect.sync(() => sockets.every((ws) => ws.ws.readyState === WebSocket.CLOSED)).pipe(Effect.repeat({
				schedule: Schedule.spaced("10 millis"),
				until: (done) => done
			}), Effect.timeoutOption(CLOSE_HANDSHAKE_WAIT));
			yield* Effect.logInfo(`ShopActor.destroy: shop=${label} sockets=${String(sockets.length)} closed=${String(Option.isSome(closed))}: storage deleted`).pipe(Effect.annotateLogs({
				shop: label,
				sockets: sockets.length,
				closed: Option.isSome(closed)
			}));
			yield* state.abort(ABORT_UNINSTALLED);
		}, Effect.provide(runtime));
		if (Option.isNone(name)) {
			const nameless = Effect.die(/* @__PURE__ */ new Error(`ShopActor: id=${label}: reached without its name`));
			const { reached } = crossDefects({ reached: () => nameless });
			const served = {
				fetch: nameless,
				alarm: () => nameless,
				...crossDefects({
					destroy,
					revoke: reached
				})
			};
			const own = (key) => typeof key !== "string" || Object.hasOwn(served, key);
			return new Proxy(served, {
				get: (target, key) => own(key) ? Reflect.get(target, key) : reached,
				getOwnPropertyDescriptor: (target, key) => own(key) ? Reflect.getOwnPropertyDescriptor(target, key) : {
					value: reached,
					writable: true,
					enumerable: true,
					configurable: true
				}
			});
		}
		const shop = name.value;
		const sql = yield* Layer.build(SqliteClient.layer({ storage: state.raw.storage })).pipe(Effect.map((context) => Context.get(context, SqlClient.SqlClient)));
		yield* SqliteMigrator.run({ loader: options.migrations }).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.orDie);
		yield* Effect.logDebug(`ShopActor.activate: shop=${shop}`).pipe(Effect.annotateLogs({ shop }));
		const notify = Effect.fn("ShopActor.notify")(function* (invalidated) {
			const frame = encodeNotice({
				_tag: "ShopActorNotice",
				invalidated
			});
			const ownFrame = encodeNotice({
				_tag: "ShopActorOwnNotice",
				invalidated
			});
			const writer = yield* Effect.serviceOption(DispatchingSocket);
			const isWriter = (socket) => Option.isSome(writer) && writer.value.ws === socket.ws;
			for (const socket of yield* state.getWebSockets()) yield* socket.send(isWriter(socket) ? ownFrame : frame).pipe(Effect.catchDefect(() => Effect.void));
		}, Effect.provide(runtime));
		const built = yield* options.build({
			shop,
			caller: Effect.map(Effect.service(CurrentCaller), (current) => current),
			sql,
			transaction: syncTransaction(sql),
			notify,
			state,
			runtime,
			closeSocket
		}).pipe(Effect.updateContext((context) => Context.merge(services, context)));
		const hooks = built.sockets ?? {};
		const socket = yield* make$1({
			group: options.rpcs,
			handlers: Layer.mergeAll(built.handlers, connectionMiddleware(shop), requireMerchantLayer),
			caller: callerSchema,
			tags: hooks.tags,
			beforeDispatch: hooks.beforeDispatch
		});
		const fetch = Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			if (request.headers.upgrade?.toLowerCase() !== "websocket") return HttpServerResponse.empty({
				status: 426,
				headers: { upgrade: "websocket" }
			});
			const caller = decodeConnectionHeader(request.headers[CONNECTION_HEADER]);
			if (Option.isNone(caller)) {
				yield* Effect.logWarning(`ShopActor.fetch: shop=${shop}: unidentified connection`).pipe(Effect.annotateLogs({ shop }));
				return yield* refusedUpgrade(CONNECTION_CLOSE_FORBIDDEN, UNIDENTIFIED_REASON);
			}
			const identity = {
				caller: caller.value,
				connectedAt: yield* DateTime.now
			};
			const accepted = yield* socket.fetch(identity);
			if (Option.isSome(accepted.socket)) {
				const role = caller.value.role;
				yield* Effect.logDebug(`ShopActor.fetch: shop=${shop} role=${role}: socket accepted`).pipe(Effect.annotateLogs({
					shop,
					role
				}));
				if (hooks.onAccept !== void 0) yield* hooks.onAccept(identity, accepted.socket.value);
			}
			return accepted.response;
		}).pipe(Effect.withSpan("ShopActor.fetch"));
		/**
		* Logs the close with the caller's role and the close code and reason, then hands the socket
		* to the transport: at Debug for a tab that closed or navigated away (1000, 1001), at Info
		* for any other code. A socket without an identity logs `role=none`.
		*/
		const webSocketClose = Effect.fn("ShopActor.webSocketClose")(function* (ws, code, reason) {
			const role = Option.match(Option.flatMap(decodeAttachment(ws.deserializeAttachment()), ({ shopActor }) => Option.fromUndefinedOr(shopActor)), {
				onNone: () => "none",
				onSome: ({ caller }) => caller.role
			});
			yield* (code === 1e3 || code === 1001 ? Effect.logDebug : Effect.logInfo)(`ShopActor.webSocketClose: shop=${shop} role=${role} code=${String(code)}${reason === "" ? "" : `: ${reason}`}`).pipe(Effect.annotateLogs({
				shop,
				role,
				code,
				reason
			}));
			yield* socket.webSocketClose(ws);
		});
		/**
		* Closes every open socket of the shop with {@link CONNECTION_CLOSE_REVOKED}, and answers how
		* many it closed. A socket is checked at connect only, so this is what makes the gate's new
		* answer reach an open tab: each reconnect asks the gate again.
		*/
		const revoke = Effect.fn("ShopActor.revoke")(function* () {
			let closed = 0;
			for (const ws of yield* state.getWebSockets()) {
				if (ws.ws.readyState !== WebSocket.OPEN) continue;
				yield* closeSocket(ws, CONNECTION_CLOSE_REVOKED, PLAN_CHANGED_REASON);
				closed += 1;
			}
			yield* Effect.logInfo(`ShopActor.revoke: shop=${shop} closed=${String(closed)}`).pipe(Effect.annotateLogs({
				shop,
				closed
			}));
			return { closed };
		}, Effect.provide(runtime));
		const alarm = built.alarm;
		const lifecycle = {
			destroy,
			revoke
		};
		return {
			fetch,
			webSocketMessage: socket.webSocketMessage,
			webSocketClose,
			webSocketError: socket.webSocketError,
			...alarm === void 0 ? {} : { alarm: () => alarm().pipe(Effect.provide(runtime)) },
			...built.methods === void 0 ? {} : crossDefects(built.methods),
			...crossDefects(lifecycle)
		};
	}).pipe(Effect.withSpan("ShopActor.activate"));
});
/** Builds an app's shop actor; see {@link make}. */
const ShopActorKit = { make };
export { ABORT_UNINSTALLED, ShopActorKit, ShopNotInstalledError };
