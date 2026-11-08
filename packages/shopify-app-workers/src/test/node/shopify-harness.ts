/**
 * `inProcessHarness`: tier 1 in this process, over `D1Test`'s real SQL, the grantors held in
 * memory and the {@link ShopifyFake}. Node only, for `D1Test`.
 *
 * @module
 */

import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AppInstallationStore } from "#internal/app-installation-store.ts";
import type { ShopDomain } from "#internal/domain.ts";
import { ShopGrantors } from "#internal/shop-grantor.ts";
import { ShopifyAccess } from "#internal/shopify-access.ts";
import { ShopifyClient } from "#internal/shopify-client.ts";
import { Shopify, ShopifyMerchant } from "#internal/shopify.ts";
import { FAKE_SHOPIFY_CREDENTIALS } from "#test/fake-app.ts";
import { ShopifyFake } from "#test/shopify-fake.ts";
import { type HeldWrite, ShopifyHarness } from "#test/shopify-harness.ts";

import { D1Test, type D1TestOptions } from "./d1-test.ts";

const ShopId = Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) });

/**
 * The store over `D1Test`, its grant writes able to be held: {@link ShopifyHarness}'s
 * `holdWrite` arms one hold, which the next `upsert` or `updateTokens` meets.
 */
const holdableStore = (options: D1TestOptions) => {
  let armed:
    | { readonly started: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
    | undefined;
  const held = <A>(write: Effect.Effect<A>) =>
    Effect.suspend(() => {
      const hold = armed;
      armed = undefined;
      return hold === undefined
        ? write
        : Deferred.succeed(hold.started, undefined).pipe(
            Effect.andThen(Deferred.await(hold.release)),
            Effect.andThen(write),
          );
    });
  const holdWrite = Effect.gen(function* () {
    // oxlint-disable-next-line typescript/no-invalid-void-type -- a signal that carries no value
    const started = yield* Deferred.make<void>();
    // oxlint-disable-next-line typescript/no-invalid-void-type -- a signal that carries no value
    const release = yield* Deferred.make<void>();
    armed = { started, release };
    return {
      started: Deferred.await(started),
      release: Effect.asVoid(Deferred.succeed(release, undefined)),
    } satisfies HeldWrite;
  });
  const store = Layer.effect(
    AppInstallationStore,
    Effect.map(AppInstallationStore, (inner) => ({
      ...inner,
      upsert: (installation: Parameters<typeof inner.upsert>[0]) =>
        held(inner.upsert(installation)),
      updateTokens: (...args: Parameters<typeof inner.updateTokens>) =>
        held(inner.updateTokens(...args)),
    })),
  ).pipe(
    // The database itself, not `D1Test.database`, which each statement would read from the
    // context it runs in: a case runs harness calls from inside a fake's reply, with none.
    // For the same reason each such call is scoped below: the D1 client is memoized on the
    // running call's `Scope`.
    Layer.provide(
      Layer.unwrap(
        Effect.map(D1Test, ({ database }) =>
          AppInstallationStore.layerD1(Effect.succeed(database)),
        ),
      ),
    ),
    Layer.provideMerge(D1Test.layer(options)),
  );
  return { store, holdWrite };
};

/**
 * {@link ShopifyHarness} in this process, with every capability, over tier 1 built as an app's
 * Backend builds it but for its backings: `D1Test` (migrated from `migrationsDir`, by default the
 * package's own), `ShopGrantors.layerMemory` and the fake app's credentials, with
 * {@link ShopifyFake} installed. Fresh per build.
 */
export const inProcessHarness = (options: D1TestOptions = {}) => {
  const { store, holdWrite } = holdableStore(options);
  const harness = Layer.effect(
    ShopifyHarness,
    Effect.gen(function* () {
      const shopify = yield* Shopify;
      const merchant = yield* ShopifyMerchant;
      const grantors = yield* ShopGrantors;
      const installations = yield* AppInstallationStore;
      const fake = yield* ShopifyFake;
      return {
        can: new Set(["clock", "interleave"] as const),
        seed: (row) =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* installations.upsert({
                shop: row.shop,
                shopGid: row.shopGid,
                scope: row.scope ?? null,
                accessToken: row.accessToken ?? null,
                accessTokenExpiresAt: row.accessTokenExpiresAt ?? null,
                refreshToken: row.refreshToken ?? null,
                refreshTokenExpiresAt: row.refreshTokenExpiresAt ?? null,
              });
              if (
                row.recognized !== false &&
                row.refreshToken !== null &&
                row.refreshToken !== undefined
              )
                yield* fake.recognize(row.shop, row.refreshToken);
            }),
          ),
        stored: installations.find,
        expireAccessToken: (shop: ShopDomain) =>
          Effect.gen(function* () {
            const row = Option.getOrThrow(yield* installations.find(shop));
            if (
              row.accessToken === null ||
              row.refreshToken === null ||
              row.refreshTokenExpiresAt === null
            )
              return yield* Effect.die(
                new Error(`expireAccessToken: shop=${shop}: no pair stored`),
              );
            yield* installations.updateTokens(shop, {
              accessToken: row.accessToken,
              accessTokenExpiresAt: yield* DateTime.now,
              refreshToken: row.refreshToken,
              refreshTokenExpiresAt: row.refreshTokenExpiresAt,
            });
          }),
        uninstall: (shop) => Effect.scoped(grantors.uninstall(shop)),
        authenticateMerchant: (idToken) =>
          Effect.map(merchant.authenticateMerchant(idToken), ({ shop, shopGid }) => ({
            shop,
            shopGid,
          })),
        ensureSession: shopify.ensureSession,
        adminGraphql: (shop, query) => shopify.adminGraphql(shop, ShopId, query),
        holdWrite,
      };
    }),
  );
  return harness.pipe(
    Layer.provideMerge(ShopifyAccess.layerNoDeps),
    Layer.provideMerge(ShopGrantors.layerMemory),
    Layer.provideMerge(ShopifyClient.layer(FAKE_SHOPIFY_CREDENTIALS)),
    Layer.provideMerge(store),
    Layer.provideMerge(ShopifyFake.layer),
  );
};
