import { ShopDomain, ShopGid } from "./domain.mjs";
import { AppNotInstalledError, InvalidIdTokenError, ReauthenticationRequiredError, ShopifyUnavailableError } from "./contract.mjs";
import { AdminToken, BACKGROUND_ACCESS_TOKEN_BUFFER, MERCHANT_ACCESS_TOKEN_BUFFER, freshAt, freshToken } from "./admin-token.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { ShopifyClient, unavailable } from "./shopify-client.mjs";
import { crossDefects } from "./defects.mjs";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { HttpResponseError, InvalidJwtError, RequestedTokenType } from "@shopify/shopify-api";
import * as Data from "effect/Data";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
// src/internal/shop-grantor.ts
/**
* The grantor: each shop's one place grants run, as a Durable Object (`ShopGrantor`) the Backend
* binds and reaches by shop (`ShopGrantors`), or held in memory for tests.
*
* @module
*/
/** How near its expiry a refresh token counts as expired: clock skew and the grant's round trip. */
const REFRESH_TOKEN_EXPIRY_BUFFER = Duration.seconds(60);
/**
* One HTTP attempt of a grant; an attempt past it is abandoned as transient. Abandoning stops the
* wait, not the request, which the library cannot cancel: see {@link GRANT_SETTLE_LIMIT}.
*/
const GRANT_ATTEMPT_DEADLINE = Duration.seconds(5);
/**
* How long the shop's next grant request waits for an abandoned attempt to settle, in the same
* grant or the next. An abandoned attempt may still complete at Shopify, and a request sent after
* it would then be retired by it (rules 2, 3) and overlap it (rule 4).
*
* The attempt budget: one wait at the start for an earlier grant's last attempt, then
* {@link GRANT_TRANSIENT_RETRIES} + 1 attempts at {@link GRANT_ATTEMPT_DEADLINE} with a wait and a
* backoff before each retry, 3 + 3 × 5 + 2 × 3 + about 1.5, about 26 s. A whole request can take
* longer: a first install adds up to 5 s for `shopGid` plus D1 I/O, about 31 s, and a caller that
* joined a grant can wait through it and then run its own, {@link GRANT_JOIN_ROUNDS}.
*
* No platform limit cuts a grant short. It runs in the grantor, a Durable Object, whose request
* or RPC has no fixed wall-time limit while the caller stays connected, and `keepAlive` is the
* object's `waitUntil`, which prevents eviction for up to 15 minutes after the caller goes. The
* Worker's own request has no fixed duration while connected either; its 30 s `waitUntil`
* extension starts only after the response or disconnect, and the grant does not need it. What
* can expire first is the caller's own deadline: a merchant's browser that gives up, or a
* webhook delivery Shopify times out. Either loses only the answer; the grant still stores its
* pair.
*
* @see https://developers.cloudflare.com/durable-objects/api/state/#waituntil
* @see https://developers.cloudflare.com/workers/platform/limits/#duration
*/
const GRANT_SETTLE_LIMIT = Duration.seconds(3);
/**
* How often a caller that joined another caller's grant decides again before giving up: a grant
* it joined answered someone else's need (a merchant joining a refresh that failed, a refresh
* joining an exchange whose ID token was refused), so it goes round, normally as the starter.
*/
const GRANT_JOIN_ROUNDS = 2;
/** A refresh grant got 401. Carries the presented refresh token, so it is never logged or exported. */
var RefreshTokenRejectedError = class extends Data.TaggedError("RefreshTokenRejectedError") {};
/**
* The response a grant failure carries: only `HttpResponseError` has one. No response, a body
* that is not JSON (the library reports either without a status) and the attempt deadline have
* none.
*/
const grantResponse = (failure) => failure instanceof HttpResponseError ? failure.response : void 0;
/** Whether a grant attempt that failed may succeed if tried again: no response, 429 or 5xx. */
const isTransientGrantFailure = (failure) => {
	if (failure instanceof InvalidJwtError) return false;
	const response = grantResponse(failure);
	return response === void 0 || response.code === 429 || response.code >= 500;
};
/** The `error` field of a Shopify error body, for the log; the request body is never logged. */
const decodeErrorField = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }));
/**
* A grant's `Session`, decoded strictly: the library leaves a field unset when Shopify omits it,
* and storing a partial pair strands the shop. An exchange also reports the granted scopes.
*/
const RefreshGrant = Schema.Struct({
	accessToken: Schema.NonEmptyString,
	expires: Schema.DateTimeUtcFromDate,
	refreshToken: Schema.NonEmptyString,
	refreshTokenExpires: Schema.DateTimeUtcFromDate
});
const ExchangeGrant = Schema.Struct({
	...RefreshGrant.fields,
	scope: Schema.String
});
/** The query whose answer {@link ShopGidResponse} decodes. */
const SHOP_GID_QUERY = `#graphql
  query ShopGid {
    shop {
      id
    }
  }`;
/** The `shop { id }` answer, the shop's Admin API id. */
const ShopGidResponse = Schema.Struct({ shop: Schema.Struct({ id: ShopGid }) });
/** Logs `<span>: shop=<shop> status=<status>`, with both values annotated. */
const logStatus = (log, span, shop, status, detail = {}) => log([`${span}: shop=${shop} status=${status}`, ...Object.entries(detail).map(([key, value]) => `${key}=${value}`)].join(" ")).pipe(Effect.annotateLogs({
	shop,
	status,
	...detail
}));
/**
* One shop's grantor: the only code that grants a token for the shop, and the only writer of
* its `AppInstallation` row's existence and token columns. It keeps all its state in memory,
* each read-and-change of it one synchronous step, atomic because the object is
* single-threaded:
*
* - `flight`, the grant in flight. A caller joins it or starts one, so one grant per shop runs at
*   a time and an exchange and a refresh never run together.
* - `epoch`, moved on by {@link uninstall}. A grant writes only under the epoch it started in.
* - `writing`, the token write a grant has sent and not yet seen answered, which `uninstall`
*   waits for, so its delete is ordered after it and a first install never outlives an
*   uninstall.
* - `abandoned`, the last request sent, if its wait passed {@link GRANT_ATTEMPT_DEADLINE}: the
*   next request waits for it, so requests stay one at a time at Shopify too.
*
* Losing the state (a deploy, an eviction) loses at most a grant in flight: the spec's repair
* state, where the next refresh is rejected and the next exchange repairs. `keepAlive` extends
* the host past the caller for a grant's promise (`waitUntil`).
*/
const makeGrantor = ({ shop, client, installations, keepAlive }) => {
	let flight;
	let epoch = 0;
	let writing;
	let abandoned;
	/**
	* Classifies a grant that failed for good, by status: the body only refines a 400 or names
	* `error` for the log. A transient failure is {@link isTransientGrantFailure}'s, once its
	* retries are spent.
	*/
	const classifyGrantFailure = (span, request, failure) => {
		if (failure instanceof InvalidJwtError) return Effect.fail(new InvalidIdTokenError());
		const response = grantResponse(failure);
		if (response === void 0 || isTransientGrantFailure(failure)) return unavailable(span, shop, `${request.grant}-retries-exhausted`, {
			httpStatus: response?.code,
			cause: failure
		});
		const { code: status, body } = response;
		const error = Option.getOrUndefined(Option.map(decodeErrorField(body), (field) => field.error));
		if (request.grant === "exchange" && status === 400 && error === "invalid_subject_token") return Effect.fail(new InvalidIdTokenError());
		if (request.grant === "refresh" && status === 401) return Effect.fail(new RefreshTokenRejectedError({
			shop,
			refreshToken: request.refreshToken
		}));
		return Effect.logError(`${span}: shop=${shop} grant=${request.grant} httpStatus=${String(status)} error=${error ?? "none"}: grant refused`).pipe(Effect.annotateLogs({
			shop,
			grant: request.grant,
			httpStatus: status,
			error: error ?? "none"
		}), Effect.andThen(Effect.die(/* @__PURE__ */ new Error(status === 401 ? "the token exchange answered 401: the app's credentials are misconfigured" : `the ${request.grant} grant answered ${String(status)}`))));
	};
	/**
	* Waits up to {@link GRANT_SETTLE_LIMIT} for the abandoned attempt, if any, and forgets it:
	* the attempt and its session when it succeeded. One that failed or did not settle is given
	* up on, so the caller sends its own request.
	*/
	const settleAbandoned = Effect.gen(function* () {
		const prior = yield* Effect.sync(() => {
			const held = abandoned;
			abandoned = void 0;
			return held;
		});
		if (prior === void 0) return Option.none();
		const exit = yield* Fiber.await(prior.attempt).pipe(Effect.timeoutOption(GRANT_SETTLE_LIMIT));
		return Option.isSome(exit) && Exit.isSuccess(exit.value) ? Option.some({
			prior,
			session: exit.value.value.session
		}) : Option.none();
	});
	/**
	* One attempt of a grant through the library, abandoned at {@link GRANT_ATTEMPT_DEADLINE}. A
	* retry first settles the attempt it abandoned, and adopts its pair when it succeeded: that
	* pair is the newest, and a second request would retire it.
	*/
	const grantAttempt = Effect.fnUntraced(function* (request, success, started) {
		const decode = Schema.decodeUnknownEffect(success);
		const adopted = yield* settleAbandoned;
		if (Option.isSome(adopted)) return yield* decode(adopted.value.session).pipe(Effect.orDie);
		const shopify = yield* client.library;
		const attempt = yield* Effect.forkDetach(Effect.tryPromise({
			try: () => request.grant === "exchange" ? shopify.auth.tokenExchange({
				shop,
				sessionToken: request.idToken,
				requestedTokenType: RequestedTokenType.OfflineAccessToken,
				expiring: true
			}) : shopify.auth.refreshToken({
				shop,
				refreshToken: request.refreshToken
			}),
			catch: (cause) => cause
		}));
		const settled = yield* Fiber.await(attempt).pipe(Effect.timeoutOption(GRANT_ATTEMPT_DEADLINE));
		if (Option.isNone(settled)) {
			yield* Effect.sync(() => {
				abandoned = {
					grant: request.grant,
					started,
					attempt
				};
			});
			return yield* new Cause.TimeoutError();
		}
		const { session } = yield* settled.value;
		return yield* decode(session).pipe(Effect.orDie);
	});
	/**
	* A grant with its transient failures retried {@link GRANT_TRANSIENT_RETRIES} times with the
	* same request, then {@link ShopifyUnavailableError}. A success is decoded strictly by `success`.
	*/
	const runGrant = (span, request, success, started) => grantAttempt(request, success, started).pipe(Effect.retry({
		schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
		times: 2,
		while: isTransientGrantFailure
	}), Effect.catch((failure) => classifyGrantFailure(span, request, failure)));
	/**
	* The shop's Admin API id, asked for once, on the first exchange, with the pair it issued,
	* bounded by {@link GRANT_ATTEMPT_DEADLINE}. A failure the merchant cannot act on here is a
	* defect.
	*/
	const fetchShopGid = Effect.fnUntraced(function* (accessToken) {
		const data = yield* client.adminCall("ShopGrantor.exchange", shop, accessToken, SHOP_GID_QUERY, void 0).pipe(Effect.timeoutOrElse({
			duration: GRANT_ATTEMPT_DEADLINE,
			orElse: () => unavailable("ShopGrantor.exchange", shop, "shop-gid-deadline")
		}), Effect.catchTag("AdminUnauthorizedError", () => unavailable("ShopGrantor.exchange", shop, "shop-gid-unauthorized")), Effect.catchTags({
			AccessDeniedError: Effect.die,
			ShopInaccessibleError: Effect.die
		}));
		return (yield* Schema.decodeUnknownEffect(ShopGidResponse)(data).pipe(Effect.orDie)).shop.id;
	});
	/**
	* Writes only if no uninstall came since `started`, registering the write in the same
	* synchronous step as the check: `uninstall` either sees it registered and waits for it, or
	* the grant sees the moved epoch, writes nothing and fails with `fenced`.
	*/
	const fencedWrite = (fenced, started, write) => Effect.gen(function* () {
		const settled = yield* Deferred.make();
		if (!(yield* Effect.sync(() => {
			if (epoch !== started) return false;
			writing = settled;
			return true;
		}))) return yield* fenced;
		return yield* write.pipe(Effect.ensuring(Effect.sync(() => {
			if (writing === settled) writing = void 0;
		}).pipe(Effect.andThen(Deferred.succeed(settled, void 0)))));
	});
	/**
	* Before a grant starts: settles an earlier grant's abandoned last attempt, and when it
	* succeeded stores its pair, the shop's newest, under that grant's epoch, as that grant would
	* have: an exchange `upsert`s with its `scope`, fetching `shopGid` on a first install, and a
	* refresh `updateTokens`. The new grant then reads the row it left.
	*/
	const adoptAbandoned = Effect.gen(function* () {
		const adopted = yield* settleAbandoned;
		if (Option.isNone(adopted)) return;
		const { prior, session } = adopted.value;
		const span = prior.grant === "exchange" ? "ShopGrantor.exchange" : "ShopGrantor.ensure";
		if (prior.grant === "exchange" ? yield* Effect.gen(function* () {
			const granted = yield* Schema.decodeUnknownEffect(ExchangeGrant)(session).pipe(Effect.orDie);
			const row = yield* installations.find(shop);
			const shopGid = Option.isSome(row) ? row.value.shopGid : yield* fetchShopGid(granted.accessToken);
			return yield* fencedWrite(Effect.succeed(false), prior.started, installations.upsert({
				shop,
				shopGid,
				scope: granted.scope,
				accessToken: granted.accessToken,
				accessTokenExpiresAt: granted.expires,
				refreshToken: granted.refreshToken,
				refreshTokenExpiresAt: granted.refreshTokenExpires
			}).pipe(Effect.as(true)));
		}) : yield* Effect.gen(function* () {
			const granted = yield* Schema.decodeUnknownEffect(RefreshGrant)(session).pipe(Effect.orDie);
			return yield* fencedWrite(Effect.succeed(false), prior.started, installations.updateTokens(shop, {
				accessToken: granted.accessToken,
				accessTokenExpiresAt: granted.expires,
				refreshToken: granted.refreshToken,
				refreshTokenExpiresAt: granted.refreshTokenExpires
			}));
		})) yield* logStatus(Effect.logInfo, span, shop, "adopted");
	});
	/**
	* Joins the grant in flight, or starts `start` as the new one, in one synchronous step, so two
	* callers never both start. The grant runs uninterruptibly on a fiber of its own, kept alive
	* past the request, and frees the slot before it settles, so a caller arriving after it sees
	* the stored row rather than a finished grant. Callers only wait, so an interrupted caller
	* never strands a pair Shopify has issued. Answers the grant's exit and whether this caller
	* started it, and the kind of grant it was.
	*/
	const join = (grant, start) => Effect.gen(function* () {
		const fresh = yield* Deferred.make();
		const taken = yield* Effect.sync(() => {
			if (flight !== void 0) return {
				flight,
				started: Option.none()
			};
			flight = {
				grant,
				done: fresh
			};
			return {
				flight,
				started: Option.some(epoch)
			};
		});
		if (Option.isSome(taken.started)) {
			const run = adoptAbandoned.pipe(Effect.andThen(start(taken.started.value)), Effect.exit, Effect.tap(() => Effect.sync(() => {
				if (flight === taken.flight) flight = void 0;
			})), Effect.flatMap((exit) => Deferred.done(fresh, exit)), Effect.uninterruptible);
			const fiber = yield* Effect.forkDetach(run);
			yield* Effect.sync(() => {
				keepAlive(Effect.runPromise(Fiber.await(fiber)));
			});
		}
		return {
			started: Option.isSome(taken.started),
			grant: taken.flight.grant,
			exit: yield* Effect.exit(Deferred.await(taken.flight.done))
		};
	});
	/** The exchange grant: the merchant's ID token for a pair, with the shop's id on a first install. */
	const exchangeGrant = (idToken, sub) => (started) => Effect.gen(function* () {
		const prior = yield* installations.find(shop);
		const now = yield* DateTime.now;
		const stored = Option.flatMap(prior, (row) => Option.map(freshToken(row, now, MERCHANT_ACCESS_TOKEN_BUFFER), (token) => ({
			shopGid: row.shopGid,
			token
		})));
		if (Option.isSome(stored)) return stored.value;
		const granted = yield* runGrant("ShopGrantor.exchange", {
			grant: "exchange",
			idToken
		}, ExchangeGrant, started).pipe(Effect.catchTag("RefreshTokenRejectedError", Effect.die));
		const shopGid = Option.isSome(prior) ? prior.value.shopGid : yield* fetchShopGid(granted.accessToken);
		yield* fencedWrite(unavailable("ShopGrantor.exchange", shop, "uninstalled-during-grant"), started, installations.upsert({
			shop,
			shopGid,
			scope: granted.scope,
			accessToken: granted.accessToken,
			accessTokenExpiresAt: granted.expires,
			refreshToken: granted.refreshToken,
			refreshTokenExpiresAt: granted.refreshTokenExpires
		}));
		yield* logStatus(Effect.logInfo, "ShopGrantor.exchange", shop, "exchanged").pipe(Effect.annotateLogs({ sub: sub ?? "none" }));
		return {
			shopGid,
			token: {
				accessToken: granted.accessToken,
				accessTokenExpiresAt: granted.expires
			}
		};
	});
	/**
	* The refresh grant, unless the stored token is fresh and is not `rejected`. A 401 is final:
	* nothing else grants for the shop, so the presented refresh token is the stored one and
	* Shopify retired it. The row is left for the next exchange to repair.
	*/
	const refreshGrant = (rejected) => (started) => Effect.gen(function* () {
		const found = yield* installations.find(shop);
		if (Option.isNone(found)) return yield* new AppNotInstalledError({ shop });
		const row = found.value;
		const now = yield* DateTime.now;
		const stored = freshToken(row, now, BACKGROUND_ACCESS_TOKEN_BUFFER);
		if (Option.isSome(stored) && stored.value.accessToken !== rejected) return {
			shopGid: row.shopGid,
			token: stored.value
		};
		const { refreshToken, refreshTokenExpiresAt } = row;
		if (refreshToken === null || refreshTokenExpiresAt === null) return yield* new ReauthenticationRequiredError({
			shop,
			refreshTokenState: "missing"
		});
		if (!freshAt(refreshTokenExpiresAt, now, REFRESH_TOKEN_EXPIRY_BUFFER)) {
			yield* logStatus(Effect.logInfo, "ShopGrantor.ensure", shop, "expired", { refreshTokenExpiresAt: DateTime.formatIso(refreshTokenExpiresAt) });
			return yield* new ReauthenticationRequiredError({
				shop,
				refreshTokenState: "expired"
			});
		}
		const granted = yield* runGrant("ShopGrantor.ensure", {
			grant: "refresh",
			refreshToken
		}, RefreshGrant, started).pipe(Effect.catchTag("InvalidIdTokenError", Effect.die), Effect.catchTag("RefreshTokenRejectedError", () => logStatus(Effect.logWarning, "ShopGrantor.ensure", shop, "rejected").pipe(Effect.andThen(Effect.fail(new ReauthenticationRequiredError({
			shop,
			refreshTokenState: "rejected"
		}))))));
		if (!(yield* fencedWrite(Effect.fail(new AppNotInstalledError({ shop })), started, installations.updateTokens(shop, {
			accessToken: granted.accessToken,
			accessTokenExpiresAt: granted.expires,
			refreshToken: granted.refreshToken,
			refreshTokenExpiresAt: granted.refreshTokenExpires
		})))) return yield* new AppNotInstalledError({ shop });
		yield* logStatus(Effect.logInfo, "ShopGrantor.ensure", shop, "refreshed");
		return {
			shopGid: row.shopGid,
			token: {
				accessToken: granted.accessToken,
				accessTokenExpiresAt: granted.expires
			}
		};
	});
	return {
		exchange: Effect.fn("ShopGrantor.exchange")(function* (idToken, sub) {
			for (let round = 0; round < GRANT_JOIN_ROUNDS; round++) {
				const joined = yield* join("exchange", exchangeGrant(idToken, sub));
				if (joined.started) return yield* Effect.map(joined.exit, ({ shopGid }) => shopGid).pipe(Effect.catchTags({
					AppNotInstalledError: Effect.die,
					ReauthenticationRequiredError: Effect.die
				}));
				if (Exit.isSuccess(joined.exit) && freshAt(joined.exit.value.token.accessTokenExpiresAt, yield* DateTime.now, MERCHANT_ACCESS_TOKEN_BUFFER)) return joined.exit.value.shopGid;
			}
			return yield* unavailable("ShopGrantor.exchange", shop, "grant-joined-without-result");
		}),
		ensure: Effect.fn("ShopGrantor.ensure")(function* (rejected) {
			for (let round = 0; round < GRANT_JOIN_ROUNDS; round++) {
				const joined = yield* join("refresh", refreshGrant(rejected));
				if (joined.started || joined.grant === "refresh" && Exit.isFailure(joined.exit)) return yield* Effect.map(joined.exit, ({ token }) => token).pipe(Effect.catchTag("InvalidIdTokenError", Effect.die));
				if (Exit.isSuccess(joined.exit) && joined.exit.value.token.accessToken !== rejected && freshAt(joined.exit.value.token.accessTokenExpiresAt, yield* DateTime.now, BACKGROUND_ACCESS_TOKEN_BUFFER)) return joined.exit.value.token;
			}
			return yield* unavailable("ShopGrantor.ensure", shop, "grant-joined-without-result");
		}),
		uninstall: Effect.fn("ShopGrantor.uninstall")(function* () {
			const pending = yield* Effect.sync(() => {
				epoch += 1;
				return writing;
			});
			if (pending !== void 0) yield* Deferred.await(pending);
			yield* installations.delete(shop);
		})
	};
};
/**
* The Durable Object class name: the object's identity on Cloudflare. It never changes, since a
* class change blocks a Workers rollback. A unit test pins {@link ShopGrantor}'s key to it.
*/
const SHOP_GRANTOR_CLASS = "ShopGrantor";
/**
* What the grantor's `exchange` answers across its stub: the shop's id, or the merchant path's
* failure. During a gradual deploy one version of the object serves the old and the new Worker,
* so this shape only gains optional fields; a unit test pins its encoding.
*/
const ExchangeAnswer = Schema.Union([Schema.TaggedStruct("Exchanged", { shopGid: ShopGid }), Schema.TaggedStruct("Refused", { error: Schema.Union([InvalidIdTokenError, ShopifyUnavailableError]) })]);
/** What the grantor's `ensure` answers across its stub: a token, or the background path's failure. Pinned as {@link ExchangeAnswer} is. */
const EnsureAnswer = Schema.Union([Schema.TaggedStruct("Ensured", { token: AdminToken }), Schema.TaggedStruct("Refused", { error: Schema.Union([
	AppNotInstalledError,
	ReauthenticationRequiredError,
	ShopifyUnavailableError
]) })]);
/**
* One shop's grantor as a Durable Object, named by its `ShopDomain`: {@link makeGrantor} in a
* single-threaded home every runtime can reach (the Backend and the shop's actor). It keeps no
* Durable Object storage, so a stray `getByName` creates nothing billed: it needs no activation
* guard, no migrations and no destroy. Declared once, here: an app binds it by building
* `ShopifyAccess.layer` and never names it.
*/
var ShopGrantor = class extends Cloudflare.DurableObject()(SHOP_GRANTOR_CLASS) {};
const encodeExchangeAnswer = Schema.encodeEffect(ExchangeAnswer);
const encodeEnsureAnswer = Schema.encodeEffect(EnsureAnswer);
const decodeExchangeAnswer = Schema.decodeEffect(ExchangeAnswer);
const decodeEnsureAnswer = Schema.decodeEffect(EnsureAnswer);
const decodeShopDomain = Schema.decodeUnknownOption(ShopDomain);
/**
* {@link ShopGrantor}'s implementation as a layer, provided in the Backend's init above the
* services it yields, so every activation uses the Backend's own {@link ShopifyClient} and D1.
*/
const ShopGrantorLive = ShopGrantor.make(Effect.gen(function* () {
	const state = yield* Cloudflare.DurableObjectState;
	const client = yield* ShopifyClient;
	const installations = yield* AppInstallationStore;
	return Effect.gen(function* () {
		const shop = yield* Effect.fromOption(decodeShopDomain(state.id.name)).pipe(Effect.orDie);
		const grantor = makeGrantor({
			shop,
			client,
			installations,
			keepAlive: (settled) => {
				state.raw.waitUntil(settled);
			}
		});
		return crossDefects({
			exchange: ({ idToken, sub }) => grantor.exchange(idToken, sub).pipe(Effect.map((shopGid) => ({
				_tag: "Exchanged",
				shopGid
			})), Effect.catch((error) => Effect.succeed({
				_tag: "Refused",
				error
			})), Effect.flatMap(encodeExchangeAnswer), Effect.orDie),
			ensure: ({ rejected }) => grantor.ensure(rejected).pipe(Effect.map((token) => ({
				_tag: "Ensured",
				token
			})), Effect.catch((error) => Effect.succeed({
				_tag: "Refused",
				error
			})), Effect.flatMap(encodeEnsureAnswer), Effect.orDie),
			uninstall: () => grantor.uninstall()
		});
	});
}));
/**
* A grantor stub call's rejection as the defect it is. The object answers every failure it
* declares as data, so a rejection is its defect (rebuilt by `crossDefects`) or a reset, which
* Alchemy's stub delivers as an `RpcCallError` in the failure channel while typing that channel
* `never`; unconverted, it would reach `Shopify`'s callers as a failure no type names. Measured
* in workerd 1.20261026.1 by the integ suite's cases 20, 24 and 38.
*/
const stubDefect = (call) => Effect.orDie(call);
/**
* Every shop's grantor, by shop: the only way to a grant. `Shopify` calls it only when the stored
* token will not do, so a call that finds one fresh in D1 makes no hop.
*/
var ShopGrantors = class ShopGrantors extends Context.Service()("app/ShopGrantors") {
	/** Over the {@link ShopGrantor} namespace, which needs {@link ShopGrantorLive}. */
	static layer = Layer.effect(ShopGrantors, Effect.gen(function* () {
		const grantors = yield* ShopGrantor;
		return {
			exchange: (shop, idToken, sub) => grantors.getByName(shop).exchange({
				idToken,
				sub
			}).pipe(stubDefect, Effect.flatMap((answer) => Effect.orDie(decodeExchangeAnswer(answer))), Effect.flatMap((answer) => answer._tag === "Exchanged" ? Effect.succeed(answer.shopGid) : Effect.fail(answer.error))),
			ensure: (shop, rejected) => grantors.getByName(shop).ensure({ rejected }).pipe(stubDefect, Effect.flatMap((answer) => Effect.orDie(decodeEnsureAnswer(answer))), Effect.flatMap((answer) => answer._tag === "Ensured" ? Effect.succeed(answer.token) : Effect.fail(answer.error))),
			uninstall: (shop) => stubDefect(grantors.getByName(shop).uninstall())
		};
	}));
	/**
	* The same grantors held in memory in this process, one per shop for the layer's life, over the
	* {@link ShopifyClient} and {@link AppInstallationStore} in context: what in-process tests run.
	*/
	static layerMemory = Layer.effect(ShopGrantors, Effect.gen(function* () {
		const client = yield* ShopifyClient;
		const installations = yield* AppInstallationStore;
		const grantors = /* @__PURE__ */ new Map();
		const grantorOf = (shop) => {
			const existing = grantors.get(shop);
			if (existing !== void 0) return existing;
			const grantor = makeGrantor({
				shop,
				client,
				installations,
				keepAlive: () => void 0
			});
			grantors.set(shop, grantor);
			return grantor;
		};
		return {
			exchange: (shop, idToken, sub) => grantorOf(shop).exchange(idToken, sub),
			ensure: (shop, rejected) => grantorOf(shop).ensure(rejected),
			uninstall: (shop) => grantorOf(shop).uninstall()
		};
	}));
};
export { EnsureAnswer, ExchangeAnswer, GRANT_ATTEMPT_DEADLINE, GRANT_SETTLE_LIMIT, SHOP_GRANTOR_CLASS, ShopGrantor, ShopGrantorLive, ShopGrantors, makeGrantor };
