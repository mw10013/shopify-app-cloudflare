import { AppInstallationStore } from "../../internal/app-installation-store.mjs";
import { ShopifyHooks } from "../../internal/hooks.mjs";
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
import { ShopifyHarness } from "../shopify-harness.mjs";
import * as Layer from "effect/Layer";
/**
 * {@link ShopifyHarness} in this process, with every capability, over both tiers built as an
 * app's Backend builds them but for their backings: `D1Test` (migrated from `migrationsDir`, by
 * default the package's own), `ShopGrantors.layerMemory`, the fake app's credentials,
 * {@link ShopifyFake} installed and {@link PartnerFake} answering the catalog's first handle.
 * `app` is the app's definition, by default the behavior app; the probe topic is added to it.
 * The hooks record each call. Fresh per build.
 */
export declare const inProcessHarness: (options?: D1TestOptions & {
  readonly app?: ShopifyAppDefinition | undefined;
}) => Layer.Layer<AppInstallationStore | AppInstallations | D1Test | MerchantGate | PartnerApi | PartnerFake | ShopGrantors | Shopify | ShopifyClient | ShopifyFake | ShopifyHarness | ShopifyHooks | ShopifyMerchant | SubscriptionPlan | Webhooks, never, never>;