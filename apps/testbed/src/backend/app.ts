import {
  PlanCatalog,
  ShopifyApp,
  type TopicHandler,
  type WebhookDelivery,
} from "@mw10013/shopify-app-cloudflare/backend";
import * as Effect from "effect/Effect";

/** Each handle must also exist in the Partner Dashboard before a merchant can pay. */
export const catalog = PlanCatalog.make({ "testbed-basic": {}, "testbed-pro": {} });

const shopUpdate: TopicHandler = Effect.fn("Testbed.shopUpdate")(function* ({
  shop,
}: WebhookDelivery) {
  yield* Effect.logInfo(`Testbed.shopUpdate: shop=${shop} status=received`).pipe(
    Effect.annotateLogs({ shop, status: "received" }),
  );
});

export const testbedApp = ShopifyApp.define({ catalog, topics: { "shop/update": shopUpdate } });
