import * as Cloudflare from "@alchemy.run/cloudflare";
import { workerNameOf } from "@mw10013/devkit/cloudflare/stage";
import {
  ShopifyAccess,
  ShopifyApp,
  ShopifyHooks,
  SubscriptionPlan,
  Webhooks,
} from "@mw10013/shopify-app-workers/backend";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { testbedApp } from "./app.ts";
import { Database } from "./resources.ts";

/**
 * The Backend's init, built once per isolate. `fetch` serves Shopify's webhooks under
 * `/webhooks/` ({@link Webhooks}), which the Website forwards; anything else is 404. A daily
 * cron, `17 4 * * *`, revalidates every stale plan ({@link SubscriptionPlan}); the event source
 * swallows a handler's failure, and `revalidateStalePlans` never fails, logging its own.
 */
const backendBody = Effect.gen(function* () {
  const webhooks = yield* Webhooks;
  const plans = yield* SubscriptionPlan;
  yield* Cloudflare.Workers.cron(
    "17 4 * * *",
    Effect.fn("Backend.scheduled")(function* () {
      yield* plans.revalidateStalePlans;
    }),
  );
  const fetch = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { pathname } = new URL(request.url, "http://backend");
    if (pathname.startsWith("/webhooks/")) return yield* webhooks.serve(request);
    return HttpServerResponse.empty({ status: 404 });
  });
  return { fetch };
});

/**
 * Tier 1 over the testbed's D1 database: building it here binds the database and the package's
 * `ShopGrantor` Durable Object to this Worker. The credentials and the Partner values come from
 * the bindings the stack makes (`bindShopifyApp`); without Partner values, billing dies on its
 * first call while webhooks and the grantor work.
 */
const shopifyAccess = Layer.unwrap(
  Effect.map(Cloudflare.D1.QueryDatabase(Database), (database) =>
    ShopifyAccess.layerConfig({ database }),
  ),
);

/**
 * The order is the layer cycle's break: tier 2 needs the hooks, which an app with shop actors
 * builds above them, and both need tier 1. The testbed has no hooks.
 */
const makeBackend = () =>
  backendBody.pipe(
    Effect.provide(ShopifyApp.layerConfig(testbedApp)),
    Effect.provide(ShopifyHooks.layerNoop),
    Effect.provide(shopifyAccess),
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
  );

/**
 * The private Effect Worker. It has no public URL: the browser and Shopify reach it only through
 * the Website, which calls it over the `BACKEND` service binding.
 */
export default class Backend extends Cloudflare.Worker<Backend>()(
  "Backend",
  {
    name: Output.fromEffect(
      Effect.map(Alchemy.Stage, (stage) => workerNameOf("testbed", stage, "backend")),
    ),
    main: import.meta.filename,
    workersDev: false,
    // Only reached through the service binding, so any free port will do.
    dev: { port: 0 },
    compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
  },
  makeBackend(),
) {}
