import * as Cloudflare from "@alchemy.run/cloudflare";
import { SHOPIFY_TEST_DOOR_PATH, ShopifyTestDoor } from "@mw10013/shopify-app-workers/test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Layer from "effect/Layer";

import { testbedApp } from "#backend/app.ts";
import { backendBody, backendProps, provideBackend, testbedHooks } from "#backend/backend.ts";

/**
 * The Backend as integ deploys it: the production body, its shop actors and tier 1
 * ({@link provideBackend}), with tier 2 over the {@link ShopifyTestDoor}'s fakes in place of the
 * Partner API and hooks that record each call before the testbed's own ({@link testbedHooks}),
 * and the door in front of its `fetch` at
 * {@link SHOPIFY_TEST_DOOR_PATH}. The door installs the Shopify fake in place of the library's
 * fetch, so the `ShopGrantor` Durable Object, in the same isolate, grants against it.
 *
 * Its own logical id keeps its bundle and logs apart from the dev server's `Backend`; nothing in
 * `src/` imports it, so the production bundle never carries the door.
 */
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
      const fetch = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { pathname } = new URL(request.url, "http://backend");
        // Effect's RPC client posts to the URL with a trailing slash.
        if (pathname === SHOPIFY_TEST_DOOR_PATH || pathname === `${SHOPIFY_TEST_DOOR_PATH}/`)
          return yield* door.serve;
        return yield* base.fetch;
      });
      // Spread first, so the methods stay beside the new `fetch`.
      return { ...base, fetch };
    }),
    ShopifyTestDoor.shopifyApp(testbedApp, testbedHooks),
  ),
) {}
