import { ShopifyHooks } from "../../internal/hooks.mjs";
import { AppInstallationStore } from "../../internal/app-installation-store.mjs";
import { ShopifyClient } from "../../internal/shopify-client.mjs";
import { ShopGrantors } from "../../internal/shop-grantor.mjs";
import { ShopifyAccess } from "../../internal/shopify-access.mjs";
import { ShopifyApp } from "../../internal/shopify-app.mjs";
import { FAKE_SHOPIFY_CREDENTIALS } from "../fake-app.mjs";
import { D1Test } from "./d1-test.mjs";
import { seedInstallation } from "../harness-support.mjs";
import { PartnerFake } from "../partner-fake.mjs";
import { ShopifyFake } from "../shopify-fake.mjs";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// src/test/node/shopify-app-test.ts
/**
* `ShopifyAppTest`: both tiers for an app's own unit tests, wired as its Backend wires them but
* over test backings: `D1Test` migrated from the app's `migrations/`, the grantors held in
* memory, the fake app's credentials, the {@link ShopifyFake} and the {@link PartnerFake}. Node
* only, for `D1Test`.
*
* @module
*/
/** `AppInstallationStore` over a fresh `D1Test`, which it also provides. */
const d1Store = (options) => Layer.unwrap(Effect.map(D1Test, ({ database }) => AppInstallationStore.layerD1(Effect.succeed(database)))).pipe(Layer.provideMerge(D1Test.layer(options)));
/**
* Both tiers over `app`, `hooks` and `store`, with the grantors in memory, the fake app's
* credentials, {@link ShopifyFake} installed and {@link PartnerFake} answering the catalog's
* first handle. Everything it builds stays in its output, so a test reaches the fakes too.
*/
const testTiers = (options) => ShopifyApp.layerNoDeps(options.app).pipe(Layer.provideMerge(options.hooks), Layer.provideMerge(PartnerFake.layer({ defaultHandle: options.app.catalog.handles[0] })), Layer.provideMerge(ShopifyAccess.layerNoDeps), Layer.provideMerge(ShopGrantors.layerMemory), Layer.provideMerge(ShopifyClient.layer(FAKE_SHOPIFY_CREDENTIALS)), Layer.provideMerge(options.store), Layer.provideMerge(ShopifyFake.layer));
/**
* An app's own tests, over its definition. `migrationsDir` is the app's `migrations/`, so its
* own tables exist beside the package's. `hooks` overrides any hook; the rest do nothing.
* `seed` stores installations before the test runs. Fresh per build.
*
* ```ts
* it.effect("a lapsed shop is sent to plan selection", () =>
*   Effect.gen(function* () {
*     const gate = yield* MerchantGate;
*     // …
*   }).pipe(Effect.provide(ShopifyAppTest.layer({ app: testbedApp, migrationsDir }))),
* );
* ```
*/
const layer = (options) => {
	return Layer.effectDiscard(Effect.gen(function* () {
		const installations = yield* AppInstallationStore;
		const fake = yield* ShopifyFake;
		for (const row of options.seed ?? []) yield* Effect.scoped(seedInstallation(installations, fake, row));
	})).pipe(Layer.provideMerge(testTiers({
		app: options.app,
		hooks: Layer.succeed(ShopifyHooks, {
			...ShopifyHooks.noop,
			...options.hooks
		}),
		store: d1Store(options)
	})));
};
const ShopifyAppTest = { layer };
export { ShopifyAppTest, d1Store, testTiers };
