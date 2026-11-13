import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  actorUpgrade,
  adminShopMethods,
  Auth,
  AUTH_BASE_PATH,
  isActorPath,
  Mailer,
  scheduledJob,
  shopActorHooks,
  shopActorObjectMethods,
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

import { catalog, testbedApp } from "./app.ts";
import { control } from "./control.ts";
import { backendMethods, counterMethods, siteMethods } from "./methods.ts";
import { Database, Email, SignInLimit } from "./resources.ts";
import { ShopActor, ShopActorLive } from "./shop-actor.ts";

/** The event source swallows a handler's failure, so `scheduledJob` logs it. */
export const backendBody = Effect.gen(function* () {
  const webhooks = yield* Webhooks;
  const plans = yield* SubscriptionPlan;
  const methods = yield* backendMethods;
  const counter = yield* counterMethods;
  const site = yield* siteMethods;
  const admin = yield* shopActorObjectMethods;
  const adminShop = yield* adminShopMethods(catalog);
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
  return { fetch, ...methods, ...counter, ...site, ...admin, ...adminShop };
});

const shopifyAccess = Layer.unwrap(
  Effect.map(Cloudflare.D1.QueryDatabase(Database), (database) =>
    ShopifyAccess.layerConfig({ database }),
  ),
);

const siteAuth = Layer.mergeAll(
  Auth.layer({ signUp: SIGN_UP_CLOSED }),
  SignInCodeDelivery.layerConfig({ appName: "Workers Testbed" }).pipe(
    Layer.provide(Mailer.layer(Email, { from: "noreply@mail.mw10013.com" })),
  ),
  SignInLimiter.layer(SignInLimit),
);

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

export const testbedHooks = Layer.effect(
  ShopifyHooks,
  Effect.gen(function* () {
    return shopActorHooks(yield* ShopActors);
  }),
);

export const productionShopifyApp = ShopifyApp.layerConfig(testbedApp).pipe(
  Layer.provideMerge(testbedHooks),
);

export const backendProps = {
  dev: { port: 0 },
  compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
};
