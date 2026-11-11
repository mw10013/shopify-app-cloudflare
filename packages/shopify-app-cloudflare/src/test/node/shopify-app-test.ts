/**
 * `ShopifyAppTest`: both tiers for an app's own unit tests, wired as its Backend wires them but
 * over test backings: `D1Test` migrated from the app's `migrations/`, the fake app's credentials
 * and signing key, the {@link ShopifyFake} and the {@link PartnerFake}. Node only, for `D1Test`.
 *
 * @module
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AppInstallationStore } from "#internal/app-installation-store.ts";
import { AppTokens } from "#internal/app-tokens.ts";
import { ShopifyHooks, type ShopifyHooksShape } from "#internal/hooks.ts";
import { ShopifyAccess } from "#internal/shopify-access.ts";
import { ShopifyApp, type ShopifyAppDefinition } from "#internal/shopify-app.ts";
import { ShopifyClient } from "#internal/shopify-client.ts";
import {
  FAKE_APP_TOKEN_KID,
  FAKE_SHOPIFY_API_KEY,
  FAKE_SHOPIFY_CREDENTIALS,
} from "#test/fake-app.ts";
import { seedInstallation } from "#test/harness-support.ts";
import { PartnerFake } from "#test/partner-fake.ts";
import { ShopifyFake } from "#test/shopify-fake.ts";
import type { SeedInstallation } from "#test/shopify-harness.ts";

import { D1Test, type D1TestOptions } from "./d1-test.ts";

/** `AppInstallationStore` over a fresh `D1Test`, which it also provides. */
export const d1Store = (options: D1TestOptions) =>
  Layer.unwrap(
    // The database itself, not `D1Test.database`, which each statement would read from the
    // context it runs in: a case runs harness calls from inside a fake's reply, with none.
    // For the same reason each such call is scoped: the D1 client is memoized on the running
    // call's `Scope`.
    Effect.map(D1Test, ({ database }) => AppInstallationStore.layerD1(Effect.succeed(database))),
  ).pipe(Layer.provideMerge(D1Test.layer(options)));

/** The library adapter and `AppTokens` over the fake app's credentials and signing key. */
export const fakeAppClients = Layer.merge(
  ShopifyClient.layer(FAKE_SHOPIFY_CREDENTIALS),
  AppTokens.layer({
    clientId: FAKE_SHOPIFY_API_KEY,
    key: FAKE_SHOPIFY_CREDENTIALS.appTokenKey,
    kid: FAKE_APP_TOKEN_KID,
  }),
);

/**
 * Both tiers over `app`, `hooks` and `store`, with the fake app's credentials and signing key, {@link ShopifyFake} installed and {@link PartnerFake} answering the catalog's
 * first handle. Everything it builds stays in its output, so a test reaches the fakes too.
 */
export const testTiers = <Entry, R, E1, E2, R2>(options: {
  readonly app: ShopifyAppDefinition<Entry, R>;
  readonly hooks: Layer.Layer<ShopifyHooks, E1>;
  readonly store: Layer.Layer<AppInstallationStore | D1Test, E2, R2>;
}) =>
  ShopifyApp.layerNoDeps(options.app).pipe(
    Layer.provideMerge(options.hooks),
    Layer.provideMerge(PartnerFake.layer({ defaultHandle: options.app.catalog.handles[0] })),
    Layer.provideMerge(ShopifyAccess.layerNoDeps),
    Layer.provideMerge(fakeAppClients),
    Layer.provideMerge(options.store),
    Layer.provideMerge(ShopifyFake.layer),
  );

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
const layer = <Entry, R>(
  options: D1TestOptions & {
    readonly app: ShopifyAppDefinition<Entry, R>;
    readonly hooks?: Partial<ShopifyHooksShape> | undefined;
    readonly seed?: readonly SeedInstallation[] | undefined;
  },
) => {
  const seeded = Layer.effectDiscard(
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      const fake = yield* ShopifyFake;
      for (const row of options.seed ?? [])
        yield* Effect.scoped(seedInstallation(installations, fake, row));
    }),
  );
  return seeded.pipe(
    Layer.provideMerge(
      testTiers({
        app: options.app,
        hooks: Layer.succeed(ShopifyHooks, { ...ShopifyHooks.noop, ...options.hooks }),
        store: d1Store(options),
      }),
    ),
  );
};

export const ShopifyAppTest = { layer };
