/**
 * `inProcessHarness`: both tiers in this process, over `D1Test`'s real SQL, the grantors held in
 * memory, the {@link ShopifyFake} and the {@link PartnerFake}. Node only, for `D1Test`.
 *
 * @module
 */

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AppInstallationStore } from "#internal/app-installation-store.ts";
import { MerchantGate } from "#internal/merchant-gate.ts";
import { ShopGrantors } from "#internal/shop-grantor.ts";
import type { ShopifyAppDefinition } from "#internal/shopify-app.ts";
import { Shopify } from "#internal/shopify.ts";
import { SubscriptionPlan } from "#internal/subscription-plan.ts";
import { Webhooks } from "#internal/webhooks.ts";
import { behaviorApp } from "#test/behavior-app.ts";
import {
  capturedLogs,
  deliverTo,
  expireAccessToken,
  recordingHooks,
  seedInstallation,
} from "#test/harness-support.ts";
import { ShopifyFake } from "#test/shopify-fake.ts";
import { type HeldWrite, ShopifyHarness } from "#test/shopify-harness.ts";

import type { D1TestOptions } from "./d1-test.ts";
import { d1Store, testTiers } from "./shopify-app-test.ts";

const ShopId = Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) });

/**
 * The store over `D1Test`, its grant writes able to be held: {@link ShopifyHarness}'s
 * `holdWrite` arms one hold, which the next `upsert` or `updateTokens` meets.
 */
const holdableStore = (options: D1TestOptions) => {
  let armed:
    | { readonly started: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
    | undefined;
  const held = <A>(write: Effect.Effect<A>) =>
    Effect.suspend(() => {
      const hold = armed;
      armed = undefined;
      return hold === undefined
        ? write
        : Deferred.succeed(hold.started, undefined).pipe(
            Effect.andThen(Deferred.await(hold.release)),
            Effect.andThen(write),
          );
    });
  const holdWrite = Effect.gen(function* () {
    // oxlint-disable-next-line typescript/no-invalid-void-type -- a signal that carries no value
    const started = yield* Deferred.make<void>();
    // oxlint-disable-next-line typescript/no-invalid-void-type -- a signal that carries no value
    const release = yield* Deferred.make<void>();
    armed = { started, release };
    return {
      started: Deferred.await(started),
      release: Effect.asVoid(Deferred.succeed(release, undefined)),
    } satisfies HeldWrite;
  });
  const store = Layer.effect(
    AppInstallationStore,
    Effect.map(AppInstallationStore, (inner) => ({
      ...inner,
      upsert: (installation: Parameters<typeof inner.upsert>[0]) =>
        held(inner.upsert(installation)),
      updateTokens: (...args: Parameters<typeof inner.updateTokens>) =>
        held(inner.updateTokens(...args)),
    })),
  ).pipe(Layer.provideMerge(d1Store(options)));
  return { store, holdWrite };
};

/**
 * {@link ShopifyHarness} in this process, with every capability, over both tiers built as an
 * app's Backend builds them but for their backings: `D1Test` (migrated from `migrationsDir`, by
 * default the package's own), `ShopGrantors.layerMemory`, the fake app's credentials,
 * {@link ShopifyFake} installed and {@link PartnerFake} answering the catalog's first handle.
 * `app` is the app's definition, by default the behavior app; the probe topic is added to it.
 * The hooks record each call. Fresh per build.
 */
export const inProcessHarness = (
  options: D1TestOptions & { readonly app?: ShopifyAppDefinition | undefined } = {},
) => {
  const { store, holdWrite } = holdableStore(options);
  const app = behaviorApp(options.app);
  const hooks = recordingHooks();
  const logs = capturedLogs();
  const harness = Layer.effect(
    ShopifyHarness,
    Effect.gen(function* () {
      const shopify = yield* Shopify;
      const gate = yield* MerchantGate;
      const plans = yield* SubscriptionPlan;
      const webhooks = yield* Webhooks;
      const grantors = yield* ShopGrantors;
      const installations = yield* AppInstallationStore;
      const fake = yield* ShopifyFake;
      return {
        can: new Set(["clock", "interleave", "holdWrite"] as const),
        seed: (row) => Effect.scoped(seedInstallation(installations, fake, row)),
        stored: installations.find,
        expireAccessToken: (shop) => expireAccessToken(installations, shop),
        uninstall: (shop) => Effect.scoped(grantors.uninstall(shop)),
        authenticateMerchant: (idToken) =>
          Effect.map(gate.authenticateMerchant(idToken), ({ shop, shopGid }) => ({
            shop,
            shopGid,
          })),
        gate,
        plans,
        deliver: deliverTo(webhooks),
        hookCalls: hooks.calls,
        breakHook: hooks.breakHook,
        logs: logs.lines,
        ensureSession: shopify.ensureSession,
        adminGraphql: (shop, query) => shopify.adminGraphql(shop, ShopId, query),
        holdWrite,
      };
    }),
  );
  return harness.pipe(
    Layer.provideMerge(testTiers({ app, hooks: hooks.layer, store })),
    Layer.provideMerge(logs.layer),
  );
};
