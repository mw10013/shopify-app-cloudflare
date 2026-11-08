import { AppInstallationStore } from "../../internal/app-installation-store.mjs";
import { ShopifyHooks, ShopifyHooksShape } from "../../internal/hooks.mjs";
import { PartnerApi } from "../../internal/partner-api.mjs";
import { ShopifyClient } from "../../internal/shopify-client.mjs";
import { ShopGrantors } from "../../internal/shop-grantor.mjs";
import { Shopify, ShopifyMerchant } from "../../internal/shopify.mjs";
import { SubscriptionPlan } from "../../internal/subscription-plan.mjs";
import { MerchantGate } from "../../internal/merchant-gate.mjs";
import { AppInstallations } from "../../internal/shopify-access.mjs";
import { Webhooks } from "../../internal/webhooks.mjs";
import { ShopifyAppDefinition } from "../../internal/shopify-app.mjs";
import "../../backend.mjs";
import { D1Test, D1TestOptions } from "./d1-test.mjs";
import { PartnerFake } from "../partner-fake.mjs";
import { ShopifyFake } from "../shopify-fake.mjs";
import { SeedInstallation } from "../shopify-harness.mjs";
import * as Layer from "effect/Layer";
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
declare const layer: <Entry, R>(options: D1TestOptions & {
  readonly app: ShopifyAppDefinition<Entry, R>;
  readonly hooks?: Partial<ShopifyHooksShape> | undefined;
  readonly seed?: readonly SeedInstallation[] | undefined;
}) => Layer.Layer<AppInstallationStore | AppInstallations | D1Test | MerchantGate | PartnerApi | PartnerFake | ShopGrantors | Shopify | ShopifyClient | ShopifyFake | ShopifyHooks | ShopifyMerchant | SubscriptionPlan | Webhooks, never, Exclude<Exclude<Exclude<Exclude<Exclude<Exclude<Exclude<Exclude<Exclude<R, import("effect/Scope").Scope>, SubscriptionPlan>, ShopifyHooks>, PartnerApi | PartnerFake>, AppInstallations | Shopify | ShopifyMerchant>, ShopGrantors>, ShopifyClient>, AppInstallationStore | D1Test>, ShopifyFake>>;
export declare const ShopifyAppTest: {
  layer: typeof layer;
};
export {};