import { ShopifyHooks } from "../internal/hooks.mjs";
import { signWebhook } from "./webhook.mjs";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as References from "effect/References";
// src/test/harness-support.ts
/**
* The parts of a {@link ShopifyHarness} that every harness builds the same way, in process or
* in a test Backend in workerd: seeding a row, ageing its token, recording the hooks and keeping
* the lines a case logs.
*
* @module
*/
/**
* Stores `row` as an exchange would and, unless `recognized` is false, tells the fake its refresh
* token, so the fake's ledger answers a refresh with it as Shopify would.
*/
const seedInstallation = (installations, fake, row) => Effect.gen(function* () {
	yield* installations.upsert({
		shop: row.shop,
		shopGid: row.shopGid,
		scope: row.scope ?? null,
		accessToken: row.accessToken ?? null,
		accessTokenExpiresAt: row.accessTokenExpiresAt ?? null,
		refreshToken: row.refreshToken ?? null,
		refreshTokenExpiresAt: row.refreshTokenExpiresAt ?? null
	});
	if (row.planHandleExpiresAt !== void 0 && row.planHandleExpiresAt !== null) yield* installations.updatePlan({
		shop: row.shop,
		planHandle: row.planHandle ?? null,
		planHandleExpiresAt: row.planHandleExpiresAt,
		planBoundaryAt: row.planBoundaryAt ?? null
	});
	if (row.recognized !== false && row.refreshToken !== null && row.refreshToken !== void 0) yield* fake.recognize(row.shop, row.refreshToken);
});
/** Ages the stored access token to expire now, as an hour passing would; dies with no pair stored. */
const expireAccessToken = (installations, shop) => Effect.gen(function* () {
	const row = Option.getOrThrow(yield* installations.find(shop));
	if (row.accessToken === null || row.refreshToken === null || row.refreshTokenExpiresAt === null) return yield* Effect.die(/* @__PURE__ */ new Error(`expireAccessToken: shop=${shop}: no pair stored`));
	yield* installations.updateTokens(shop, {
		accessToken: row.accessToken,
		accessTokenExpiresAt: yield* DateTime.now,
		refreshToken: row.refreshToken,
		refreshTokenExpiresAt: row.refreshTokenExpiresAt
	});
});
/** Hooks that record each call, and die once on a hook a case broke; `reset` forgets both. */
const recordingHooks = () => {
	const calls = [];
	const broken = /* @__PURE__ */ new Set();
	const run = (hook, call) => Effect.suspend(() => {
		calls.push(call);
		return broken.delete(hook) ? Effect.die(/* @__PURE__ */ new Error(`${hook}: broken by the case`)) : Effect.void;
	});
	return {
		layer: Layer.succeed(ShopifyHooks, {
			beforeUninstall: (shop) => run("beforeUninstall", `beforeUninstall:${shop}`),
			afterUninstall: (shop) => run("afterUninstall", `afterUninstall:${shop}`),
			beforePlanChange: (shop) => run("beforePlanChange", `beforePlanChange:${shop}`),
			afterPlanRevalidated: ({ shop, changed, next }) => run("afterPlanRevalidated", `afterPlanRevalidated:${shop}:changed=${String(changed)}:next=${next?.handle ?? "none"}`)
		}),
		calls: Effect.sync(() => [...calls]),
		breakHook: (hook) => Effect.sync(() => {
			broken.add(hook);
		}),
		reset: Effect.sync(() => {
			calls.length = 0;
			broken.clear();
		})
	};
};
/**
* Every line, Debug included, kept for the case, with the level Effect logged it at; Warning
* and above also printed, so a failing case still shows its errors.
*/
const capturedLogs = () => {
	const lines = [];
	const logger = Logger.make((options) => {
		const { message, logLevel } = options;
		lines.push({
			level: logLevel,
			message: String(Array.isArray(message) ? message[0] : message)
		});
		if (LogLevel.isGreaterThanOrEqualTo(logLevel, "Warn")) Logger.defaultLogger.log(options);
	});
	return {
		layer: Layer.merge(Logger.layer([logger]), Layer.succeed(References.MinimumLogLevel, "All")),
		lines: Effect.sync(() => [...lines])
	};
};
/** POSTs a delivery, signed as Shopify signs one unless `signed` is false, to `Webhooks.serve`: its status. */
const deliverTo = (webhooks) => ({ topic, shop, payload, signed }) => Effect.scoped(Effect.gen(function* () {
	const body = JSON.stringify(payload);
	const headers = yield* signWebhook(topic, shop, body);
	const request = new Request(`https://backend.test/webhooks/${topic}`, {
		method: "POST",
		headers: signed === false ? {
			...headers,
			"x-shopify-hmac-sha256": "unsigned"
		} : headers,
		body
	});
	return (yield* webhooks.serve(HttpServerRequest.fromWeb(request))).status;
}));
export { capturedLogs, deliverTo, expireAccessToken, recordingHooks, seedInstallation };
