/**
 * The testbed as the package sees it: its plan catalog and its one extra webhook topic. The
 * Backend dispatches from this value and the toml check reads its topics from it, so the two
 * cannot drift.
 *
 * @module
 */

import {
  PlanCatalog,
  ShopifyApp,
  type TopicHandler,
  type WebhookDelivery,
} from "@mw10013/shopify-app-workers/backend";
import * as Effect from "effect/Effect";

/** One plan. Its handle must also exist in the Partner Dashboard before a merchant can pay. */
export const catalog = PlanCatalog.make({ "testbed-basic": {} });

/** `shop/update`: logged only, to exercise the extra-topic seam end to end. */
const shopUpdate: TopicHandler = Effect.fn("Testbed.shopUpdate")(function* ({
  shop,
}: WebhookDelivery) {
  yield* Effect.logInfo(`Testbed.shopUpdate: shop=${shop} status=received`).pipe(
    Effect.annotateLogs({ shop, status: "received" }),
  );
});

export const testbedApp = ShopifyApp.define({ catalog, topics: { "shop/update": shopUpdate } });
