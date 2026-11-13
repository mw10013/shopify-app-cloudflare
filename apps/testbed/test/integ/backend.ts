import * as Cloudflare from "@alchemy.run/cloudflare";
import { serveAll, ShopActors, type ShopDomain } from "@mw10013/shopify-app-cloudflare/backend";
import { SHOPIFY_TEST_DOOR_PATH, ShopifyTestDoor } from "@mw10013/shopify-app-cloudflare/test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { testbedApp } from "#backend/app.ts";
import { backendBody, backendProps, provideBackend, testbedHooks } from "#backend/backend.ts";

export default class TestBackend extends Cloudflare.Worker<TestBackend>()(
  "TestBackend",
  { ...backendProps, main: import.meta.filename },
  provideBackend(
    Effect.gen(function* () {
      // Built in the init's own scope, the isolate's, which never closes: under
      // `Effect.provide` the door's scope would close when the init returns, and the Shopify
      // fake, released with it, would hand the library back the real fetch.
      const door = Context.get(yield* Layer.build(ShopifyTestDoor.layer), ShopifyTestDoor);
      const base = yield* backendBody;
      const actors = yield* ShopActors;
      const shopActorId = serveAll(
        {
          shopActorId: (payload: { readonly shop: ShopDomain }) =>
            Effect.succeed(actors.idOf(payload.shop)),
        },
        { shopActorId: Schema.Never },
      );
      const fetch = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { pathname } = new URL(request.url, "http://backend");
        // Effect's RPC client posts to the URL with a trailing slash.
        if (pathname === SHOPIFY_TEST_DOOR_PATH || pathname === `${SHOPIFY_TEST_DOOR_PATH}/`)
          return yield* door.serve;
        return yield* base.fetch;
      });
      return { ...base, ...shopActorId, fetch };
    }),
    ShopifyTestDoor.shopifyApp(testbedApp, testbedHooks),
  ),
) {}
