/**
 * The Backend's wiring, apart from its Worker so a test Backend reuses it: the body, the layers
 * under it and the Worker's props.
 *
 * @module
 */

import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  scheduledJob,
  ShopifyAccess,
  ShopifyApp,
  ShopifyHooks,
  SubscriptionPlan,
  Webhooks,
} from "@mw10013/shopify-app-workers/backend";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { testbedApp } from "./app.ts";
import { backendMethods } from "./methods.ts";
import { Database } from "./resources.ts";

/**
 * The Backend's init, built once per isolate. `fetch` serves Shopify's webhooks under
 * `/webhooks/` ({@link Webhooks}), which the Website forwards; anything else is 404. The
 * methods ({@link backendMethods}) serve the Website over the binding. A daily cron, `17 4 * * *`,
 * revalidates every stale plan ({@link SubscriptionPlan}); the event source swallows a handler's
 * failure, so `scheduledJob` logs it.
 */
export const backendBody = Effect.gen(function* () {
  const webhooks = yield* Webhooks;
  const plans = yield* SubscriptionPlan;
  const methods = yield* backendMethods;
  yield* Cloudflare.Workers.cron(
    "17 4 * * *",
    Effect.fn("Backend.scheduled")(function* () {
      yield* scheduledJob("revalidateStalePlans", plans.revalidateStalePlans);
    }),
  );
  const fetch = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { pathname } = new URL(request.url, "http://backend");
    if (pathname.startsWith("/webhooks/")) return yield* webhooks.serve(request);
    return HttpServerResponse.empty({ status: 404 });
  });
  return { fetch, ...methods };
});

/**
 * Tier 1 over the testbed's D1 database: building it here binds the database and the package's
 * `ShopGrantor` Durable Object to this Worker. The credentials and the Partner values come from
 * the bindings the stack makes (`bindShopifyApp`); without Partner credentials, billing dies on
 * its first Partner call while webhooks, the grantor and a shop with a cached plan work.
 */
const shopifyAccess = Layer.unwrap(
  Effect.map(Cloudflare.D1.QueryDatabase(Database), (database) =>
    ShopifyAccess.layerConfig({ database }),
  ),
);

/**
 * Provides `body` with the Backend's services over `shopifyApp`, tier 2 and the app's hooks
 * together: the production one ({@link productionShopifyApp}), or a test Backend's. The order
 * is the layer cycle's break: tier 2 needs the hooks, which an app with shop actors builds above
 * its actors, and both need tier 1.
 */
export const provideBackend = <A, E, R, ROut, E2, R2>(
  body: Effect.Effect<A, E, R>,
  shopifyApp: Layer.Layer<ROut, E2, R2>,
) =>
  body.pipe(
    Effect.provide(shopifyApp),
    Effect.provide(shopifyAccess),
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
  );

/** Tier 2 over the testbed's app and the Partner API, with no hooks: the testbed has none. */
export const productionShopifyApp = ShopifyApp.layerConfig(testbedApp).pipe(
  Layer.provideMerge(ShopifyHooks.layerNoop),
);

/** The Worker's props, which a test Backend shares but for its name and entry. */
export const backendProps = {
  // Only reached through the service binding, so any free port will do.
  dev: { port: 0 },
  compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
};
