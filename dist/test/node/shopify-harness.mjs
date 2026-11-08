import { AppInstallationStore } from "../../internal/app-installation-store.mjs";
import { ShopGrantors } from "../../internal/shop-grantor.mjs";
import { Shopify } from "../../internal/shopify.mjs";
import { SubscriptionPlan } from "../../internal/subscription-plan.mjs";
import { MerchantGate } from "../../internal/merchant-gate.mjs";
import { Webhooks } from "../../internal/webhooks.mjs";
import { capturedLogs, deliverTo, expireAccessToken, recordingHooks, seedInstallation } from "../harness-support.mjs";
import { ShopifyFake } from "../shopify-fake.mjs";
import { d1Store, testTiers } from "./shopify-app-test.mjs";
import { behaviorApp } from "../behavior-app.mjs";
import { ShopifyHarness } from "../shopify-harness.mjs";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
// src/test/node/shopify-harness.ts
/**
* `inProcessHarness`: both tiers in this process, over `D1Test`'s real SQL, the grantors held in
* memory, the {@link ShopifyFake} and the {@link PartnerFake}. Node only, for `D1Test`.
*
* @module
*/
const ShopId = Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) });
/**
* The store over `D1Test`, its grant writes able to be held: {@link ShopifyHarness}'s
* `holdWrite` arms one hold, which the next `upsert` or `updateTokens` meets.
*/
const holdableStore = (options) => {
	let armed;
	const held = (write) => Effect.suspend(() => {
		const hold = armed;
		armed = void 0;
		return hold === void 0 ? write : Deferred.succeed(hold.started, void 0).pipe(Effect.andThen(Deferred.await(hold.release)), Effect.andThen(write));
	});
	const holdWrite = Effect.gen(function* () {
		const started = yield* Deferred.make();
		const release = yield* Deferred.make();
		armed = {
			started,
			release
		};
		return {
			started: Deferred.await(started),
			release: Effect.asVoid(Deferred.succeed(release, void 0))
		};
	});
	return {
		store: Layer.effect(AppInstallationStore, Effect.map(AppInstallationStore, (inner) => ({
			...inner,
			upsert: (installation) => held(inner.upsert(installation)),
			updateTokens: (...args) => held(inner.updateTokens(...args))
		}))).pipe(Layer.provideMerge(d1Store(options))),
		holdWrite
	};
};
/**
* {@link ShopifyHarness} in this process, with every capability, over both tiers built as an
* app's Backend builds them but for their backings: `D1Test` (migrated from `migrationsDir`, by
* default the package's own), `ShopGrantors.layerMemory`, the fake app's credentials,
* {@link ShopifyFake} installed and {@link PartnerFake} answering the catalog's first handle.
* `app` is the app's definition, by default the behavior app; the probe topic is added to it.
* The hooks record each call. Fresh per build.
*/
const inProcessHarness = (options = {}) => {
	const { store, holdWrite } = holdableStore(options);
	const app = behaviorApp(options.app);
	const hooks = recordingHooks();
	const logs = capturedLogs();
	return Layer.effect(ShopifyHarness, Effect.gen(function* () {
		const shopify = yield* Shopify;
		const gate = yield* MerchantGate;
		const plans = yield* SubscriptionPlan;
		const webhooks = yield* Webhooks;
		const grantors = yield* ShopGrantors;
		const installations = yield* AppInstallationStore;
		const fake = yield* ShopifyFake;
		return {
			can: /* @__PURE__ */ new Set([
				"clock",
				"interleave",
				"holdWrite"
			]),
			seed: (row) => Effect.scoped(seedInstallation(installations, fake, row)),
			stored: installations.find,
			expireAccessToken: (shop) => expireAccessToken(installations, shop),
			uninstall: (shop) => Effect.scoped(grantors.uninstall(shop)),
			authenticateMerchant: (idToken) => Effect.map(gate.authenticateMerchant(idToken), ({ shop, shopGid }) => ({
				shop,
				shopGid
			})),
			gate,
			plans,
			deliver: deliverTo(webhooks),
			hookCalls: hooks.calls,
			breakHook: hooks.breakHook,
			logs: logs.lines,
			ensureSession: shopify.ensureSession,
			adminGraphql: (shop, query) => shopify.adminGraphql(shop, ShopId, query),
			holdWrite
		};
	})).pipe(Layer.provideMerge(testTiers({
		app,
		hooks: hooks.layer,
		store
	})), Layer.provideMerge(logs.layer));
};
export { inProcessHarness };
