/**
 * `inProcessHarness`: both tiers in this process, over `D1Test`'s real SQL, the
 * {@link ShopifyFake} and the {@link PartnerFake}. Node only, for `D1Test`.
 *
 * @module
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AppInstallationStore } from "#internal/app-installation-store.ts";
import { MerchantGate } from "#internal/merchant-gate.ts";
import type { ShopifyAppDefinition } from "#internal/shopify-app.ts";
import { Shopify } from "#internal/shopify.ts";
import { SubscriptionPlan } from "#internal/subscription-plan.ts";
import { Webhooks } from "#internal/webhooks.ts";
import { behaviorApp } from "#test/behavior-app.ts";
import {
  capturedLogs,
  deliverTo,
  recordingHooks,
  seedInstallation,
  uninstall,
} from "#test/harness-support.ts";
import { ShopifyFake } from "#test/shopify-fake.ts";
import { ShopifyHarness } from "#test/shopify-harness.ts";

import type { D1TestOptions } from "./d1-test.ts";
import { d1Store, testTiers } from "./shopify-app-test.ts";

const ShopId = Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) });

/**
 * {@link ShopifyHarness} in this process, with every capability, over both tiers built as an
 * app's Backend builds them but for their backings: `D1Test` (migrated from `migrationsDir`, by
 * default the package's own), the fake app's credentials, {@link ShopifyFake} installed and
 * {@link PartnerFake} answering the catalog's first handle. `app` is the app's definition, by
 * default the behavior app; the probe topic is added to it. The hooks record each call. Fresh
 * per build.
 */
export const inProcessHarness = (
  options: D1TestOptions & { readonly app?: ShopifyAppDefinition | undefined } = {},
) => {
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
      const installations = yield* AppInstallationStore;
      const fake = yield* ShopifyFake;
      return {
        can: new Set(["clock", "interleave"] as const),
        seed: (row) => Effect.scoped(seedInstallation(installations, fake, row)),
        stored: installations.find,
        uninstall: (shop) => Effect.scoped(uninstall(installations, fake, shop)),
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
      };
    }),
  );
  return harness.pipe(
    Layer.provideMerge(testTiers({ app, hooks: hooks.layer, store: d1Store(options) })),
    Layer.provideMerge(logs.layer),
  );
};
