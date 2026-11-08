import { ShopDomain, ShopGid } from "../internal/domain.mjs";
import { AppInstallation, AppInstallationStore } from "../internal/app-installation-store.mjs";
import { ShopGrantors } from "../internal/shop-grantor.mjs";
import { Shopify } from "../internal/shopify.mjs";
import { SubscriptionPlan } from "../internal/subscription-plan.mjs";
import { MerchantGate } from "../internal/merchant-gate.mjs";
import { Webhooks } from "../internal/webhooks.mjs";
import { ShopifyApp } from "../internal/shopify-app.mjs";
import { capturedLogs, deliverTo, expireAccessToken, recordingHooks, seedInstallation } from "./harness-support.mjs";
import { PartnerAnswer, PartnerFake } from "./partner-fake.mjs";
import { ShopifyFake, ShopifyFakeCall, ShopifyFakeReply } from "./shopify-fake.mjs";
import { behaviorApp } from "./behavior-app.mjs";
import { SeedInstallation, ShopifyHarness } from "./shopify-harness.mjs";
import { REQUIRED_BEHAVIORS } from "./required-behaviors.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
// src/test/test-door.ts
/**
* `ShopifyTestDoor`: what a test Backend in workerd mounts so an integ suite can drive the real
* Backend: the required behaviors run inside it, against the real `ShopGrantor` Durable Object
* and the real D1, and the fakes are scripted and the installations seeded and read from the
* test process. Only a test Backend builds it; the production Backend never imports `/test`.
*
* @module
*/
/** Where a test Backend serves the door: an Effect RPC endpoint, NDJSON. */
const SHOPIFY_TEST_DOOR_PATH = "/api/test/shopify";
/**
* What the door's harness can do. A case runs in the test Backend's isolate, which the grantor
* Durable Object shares, so the fake's intercept gates the object's grant. Time is the runtime's,
* and the store the object writes through is the production one, so `clock` and `holdWrite` are
* in-process only.
*/
const SHOPIFY_TEST_DOOR_CAN = /* @__PURE__ */ new Set(["interleave"]);
/** How a required behavior ended in the test Backend: its cause, pretty-printed, when it failed. */
const BehaviorOutcome = Schema.Union([Schema.TaggedStruct("Passed", {}), Schema.TaggedStruct("Failed", { cause: Schema.String })]);
/**
* The door's procedures.
*
* - `RunBehavior` resets the door's state (`Reset`), then runs `REQUIRED_BEHAVIORS[index]` in the
*   test Backend; `name` is the runner's `<id>: <name>`, checked so the two lists cannot drift.
* - `Reset` uninstalls every installed shop through its grantor, then forgets every script,
*   call, issued token and hook call, as a fresh harness would start.
* - `ScriptShopify` and `ShopifyCalls` are {@link ShopifyFake}'s `script` and `calls`;
*   `ScriptPartner` and `PartnerAsked` are {@link PartnerFake}'s `script` and `asked`.
* - `Seed` stores an installation as an exchange would; `Stored` reads one back, tokens
*   included.
*/
const ShopifyTestDoorRpcs = RpcGroup.make(Rpc.make("RunBehavior", {
	payload: {
		index: Schema.Int,
		name: Schema.String
	},
	success: BehaviorOutcome
}), Rpc.make("Reset", {
	payload: {},
	success: Schema.Struct({})
}), Rpc.make("ScriptShopify", {
	payload: { replies: Schema.Array(ShopifyFakeReply) },
	success: Schema.Struct({})
}), Rpc.make("ShopifyCalls", {
	payload: {},
	success: Schema.Array(ShopifyFakeCall)
}), Rpc.make("ScriptPartner", {
	payload: {
		shopGid: ShopGid,
		answer: PartnerAnswer
	},
	success: Schema.Struct({})
}), Rpc.make("PartnerAsked", {
	payload: {},
	success: Schema.Array(ShopGid)
}), Rpc.make("Seed", {
	payload: { row: SeedInstallation },
	success: Schema.Struct({})
}), Rpc.make("Stored", {
	payload: { shop: ShopDomain },
	success: Schema.NullOr(AppInstallation)
}));
/** The hooks the door records, as {@link ShopifyTestDoor.shopifyApp} provides them. */
var DoorHooks = class extends Context.Service()("app/ShopifyTestDoorHooks") {};
/**
* Tier 2 as a test Backend provides it in place of `ShopifyApp.layerConfig(app)` and the app's
* hooks: over `app` with the probe topic added, as `inProcessHarness` builds it, the
* {@link PartnerFake} answering the catalog's first handle, and hooks that record each call.
*/
const shopifyApp = (app) => {
	const definition = behaviorApp(app);
	const hooks = Layer.unwrap(Effect.sync(() => {
		const recorder = recordingHooks();
		return Layer.merge(recorder.layer, Layer.succeed(DoorHooks, recorder));
	}));
	return ShopifyApp.layerNoDeps(definition).pipe(Layer.provideMerge(hooks), Layer.provideMerge(PartnerFake.layer({ defaultHandle: definition.catalog.handles[0] })));
};
const make = Effect.gen(function* () {
	const shopify = yield* Shopify;
	const gate = yield* MerchantGate;
	const plans = yield* SubscriptionPlan;
	const webhooks = yield* Webhooks;
	const grantors = yield* ShopGrantors;
	const installations = yield* AppInstallationStore;
	const fake = yield* ShopifyFake;
	const partner = yield* PartnerFake;
	const hooks = yield* DoorHooks;
	const ShopId = Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) });
	const harnessOf = (logs) => ({
		can: SHOPIFY_TEST_DOOR_CAN,
		seed: (row) => Effect.scoped(seedInstallation(installations, fake, row)),
		stored: (shop) => Effect.scoped(installations.find(shop)),
		expireAccessToken: (shop) => Effect.scoped(expireAccessToken(installations, shop)),
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
		logs,
		ensureSession: shopify.ensureSession,
		adminGraphql: (shop, query) => shopify.adminGraphql(shop, ShopId, query),
		holdWrite: Effect.die(/* @__PURE__ */ new Error("ShopifyTestDoor: holdWrite is in-process only"))
	});
	const reset = Effect.scoped(Effect.gen(function* () {
		for (const shop of yield* installations.shops()) yield* grantors.uninstall(shop);
		yield* fake.reset;
		yield* partner.reset;
		yield* hooks.reset;
	}));
	const runBehavior = Effect.fn("ShopifyTestDoor.runBehavior")(function* (index, name) {
		const behavior = REQUIRED_BEHAVIORS[index];
		if (behavior === void 0 || `${behavior.id}: ${behavior.name}` !== name) return yield* Effect.die(/* @__PURE__ */ new Error(`ShopifyTestDoor.runBehavior: index=${String(index)}: not "${name}"`));
		const missing = behavior.needs.filter((need) => !SHOPIFY_TEST_DOOR_CAN.has(need));
		if (missing.length > 0) return yield* Effect.die(/* @__PURE__ */ new Error(`ShopifyTestDoor.runBehavior: "${name}" needs ${missing.join(", ")}`));
		yield* reset;
		const logs = capturedLogs();
		const exit = yield* behavior.run.pipe(Effect.provideService(ShopifyHarness, harnessOf(logs.lines)), Effect.provideService(ShopifyFake, fake), Effect.provideService(PartnerFake, partner), Effect.provide(logs.layer), Effect.scoped, Effect.exit);
		return Exit.isSuccess(exit) ? { _tag: "Passed" } : {
			_tag: "Failed",
			cause: Cause.pretty(exit.cause)
		};
	});
	const handlers = ShopifyTestDoorRpcs.toLayer(Effect.succeed(ShopifyTestDoorRpcs.of({
		RunBehavior: ({ index, name }) => runBehavior(index, name),
		Reset: () => Effect.as(reset, {}),
		ScriptShopify: ({ replies }) => Effect.as(fake.script(replies), {}),
		ShopifyCalls: () => fake.calls,
		ScriptPartner: ({ shopGid, answer }) => Effect.as(partner.script(shopGid, answer), {}),
		PartnerAsked: () => partner.asked,
		Seed: ({ row }) => Effect.as(Effect.scoped(seedInstallation(installations, fake, row)), {}),
		Stored: ({ shop }) => Effect.map(Effect.scoped(installations.find(shop)), Option.getOrNull)
	})));
	return { serve: Effect.flatten(RpcServer.toHttpEffect(ShopifyTestDoorRpcs).pipe(Effect.provide(Layer.merge(handlers, RpcSerialization.layerNdjson)))) };
});
/**
* The door, as a test Backend builds it inside its init, under {@link ShopifyTestDoor.shopifyApp}
* and the production tier 1:
*
* ```ts
* backendBody.pipe(
*   Effect.provide(ShopifyTestDoor.layer),
*   Effect.provide(ShopifyTestDoor.shopifyApp(app)),
*   Effect.provide(ShopifyAccess.layerConfig({ database })),
* );
* // and in fetch: if (pathname === SHOPIFY_TEST_DOOR_PATH) return yield* door.serve;
* ```
*
* It installs {@link ShopifyFake} in place of the Shopify library's fetch for the isolate's life;
* the grantor Durable Object runs in the same isolate, so its grants reach the fake too.
*/
var ShopifyTestDoor = class ShopifyTestDoor extends Context.Service()("app/ShopifyTestDoor") {
	static layer = Layer.effect(ShopifyTestDoor, make).pipe(Layer.provide(ShopifyFake.layer));
	static shopifyApp = shopifyApp;
};
export { BehaviorOutcome, SHOPIFY_TEST_DOOR_CAN, SHOPIFY_TEST_DOOR_PATH, ShopifyTestDoor, ShopifyTestDoorRpcs };
