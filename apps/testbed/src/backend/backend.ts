/**
 * The Backend's wiring, apart from its Worker so a test Backend reuses it: the body, the layers
 * under it and the Worker's props.
 *
 * @module
 */

import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  actorUpgrade,
  Auth,
  AUTH_BASE_PATH,
  isActorPath,
  Mailer,
  scheduledJob,
  shopActorHooks,
  ShopActorObjects,
  ShopActors,
  ShopifyAccess,
  ShopifyApp,
  ShopifyHooks,
  SIGN_UP_CLOSED,
  SignInCodeDelivery,
  SignInLimiter,
  SubscriptionPlan,
  Webhooks,
} from "@mw10013/shopify-app-cloudflare/backend";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";

import { testbedApp } from "./app.ts";
import { control } from "./control.ts";
import { adminMethods, backendMethods, counterMethods, siteMethods } from "./methods.ts";
import { Database, Email, SignInLimit } from "./resources.ts";
import { ShopActor, ShopActorLive } from "./shop-actor.ts";

/**
 * The Backend's init, built once per isolate. `fetch` serves Shopify's webhooks under
 * `/webhooks/` ({@link Webhooks}), the shop actor's sockets under `/api/actor/<shop>`
 * ({@link actorUpgrade}), Better Auth's code check and sign-out under `/api/auth/` ({@link Auth})
 * and the control door, each forwarded by the Website; anything else is 404. The methods
 * ({@link backendMethods}, {@link counterMethods}, {@link siteMethods}, {@link adminMethods})
 * serve the Website over the binding. A daily cron, `17 4 * * *`, revalidates every stale plan
 * ({@link SubscriptionPlan}); the event source swallows a handler's failure, so `scheduledJob`
 * logs it.
 */
export const backendBody = Effect.gen(function* () {
  const webhooks = yield* Webhooks;
  const plans = yield* SubscriptionPlan;
  const methods = yield* backendMethods;
  const counter = yield* counterMethods;
  const site = yield* siteMethods;
  const admin = yield* adminMethods;
  const auth = yield* Auth;
  const door = yield* control;
  const upgrade = yield* actorUpgrade(ShopActor);
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
    if (isActorPath(pathname)) return yield* upgrade(request);
    if (pathname.startsWith(`${AUTH_BASE_PATH}/`)) return yield* auth.serve;
    if (door.isPath(pathname)) return yield* door.serve(request);
    return HttpServerResponse.empty({ status: 404 });
  });
  return { fetch, ...methods, ...counter, ...site, ...admin };
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
 * Site sign-in for the testbed's admin: sign-up closed, so only the users the stage's seed writes
 * sign in. Codes go where the stage's `SIGN_IN_CODE_DELIVERY` says, mailed through the Email
 * Service binding, and requests are limited per client and per address by {@link SignInLimit}.
 */
const siteAuth = Layer.mergeAll(
  Auth.layer({ signUp: SIGN_UP_CLOSED }),
  SignInCodeDelivery.layerConfig({ appName: "Workers Testbed" }).pipe(
    Layer.provide(Mailer.layer(Email, { from: "noreply@mail.mw10013.com" })),
  ),
  SignInLimiter.layer(SignInLimit),
);

/**
 * Provides `body` with the Backend's services over `shopifyApp`, tier 2 and the app's hooks
 * together: the production one ({@link productionShopifyApp}), or a test Backend's. The order
 * is the layer cycle's break: tier 2 needs the hooks, the hooks need the shop actors, and the
 * actors need tier 1.
 */
export const provideBackend = <A, E, R, ROut, E2, R2>(
  body: Effect.Effect<A, E, R>,
  shopifyApp: Layer.Layer<ROut, E2, R2>,
) =>
  body.pipe(
    Effect.provide(shopifyApp),
    Effect.provide(ShopActorObjects.layerConfig),
    Effect.provide(siteAuth),
    Effect.provide(ShopActors.layer(ShopActor)),
    Effect.provide(ShopActorLive),
    Effect.provide(shopifyAccess),
    Effect.provide(CloudflareD1(Database)),
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.Email.SendBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
  );

/**
 * The testbed's hooks, the package's over its shop actors ({@link shopActorHooks}): uninstall
 * destroys the shop's actor, and a plan change closes its sockets.
 */
export const testbedHooks = Layer.effect(
  ShopifyHooks,
  Effect.gen(function* () {
    return shopActorHooks(yield* ShopActors);
  }),
);

/** Tier 2 over the testbed's app, the Partner API and {@link testbedHooks}. */
export const productionShopifyApp = ShopifyApp.layerConfig(testbedApp).pipe(
  Layer.provideMerge(testbedHooks),
);

/** The Worker's props, which a test Backend shares but for its name and entry. */
export const backendProps = {
  // Only reached through the service binding, so any free port will do.
  dev: { port: 0 },
  compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
};
