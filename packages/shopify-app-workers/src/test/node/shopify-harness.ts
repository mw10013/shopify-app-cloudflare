/**
 * `inProcessHarness`: both tiers in this process, over `D1Test`'s real SQL, the grantors held in
 * memory, the {@link ShopifyFake} and the {@link PartnerFake}. Node only, for `D1Test`.
 *
 * @module
 */

import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";

import { AppInstallationStore } from "#internal/app-installation-store.ts";
import type { ShopDomain } from "#internal/domain.ts";
import { ShopifyHooks, type ShopifyHooksShape } from "#internal/hooks.ts";
import { MerchantGate } from "#internal/merchant-gate.ts";
import { ShopGrantors } from "#internal/shop-grantor.ts";
import { ShopifyAccess } from "#internal/shopify-access.ts";
import { ShopifyApp, type ShopifyAppDefinition } from "#internal/shopify-app.ts";
import { ShopifyClient } from "#internal/shopify-client.ts";
import { Shopify } from "#internal/shopify.ts";
import { SubscriptionPlan } from "#internal/subscription-plan.ts";
import { Webhooks } from "#internal/webhooks.ts";
import { behaviorApp } from "#test/behavior-app.ts";
import { FAKE_SHOPIFY_CREDENTIALS } from "#test/fake-app.ts";
import { PartnerFake } from "#test/partner-fake.ts";
import { ShopifyFake } from "#test/shopify-fake.ts";
import {
  type HarnessLogLine,
  type HeldWrite,
  type HookName,
  ShopifyHarness,
} from "#test/shopify-harness.ts";
import { signWebhook } from "#test/webhook.ts";

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

/** Hooks that record each call, and die once on a hook a case broke. */
const recordingHooks = () => {
  const calls: string[] = [];
  const broken = new Set<HookName>();
  const run = (hook: HookName, call: string) =>
    Effect.suspend(() => {
      calls.push(call);
      return broken.delete(hook)
        ? Effect.die(new Error(`${hook}: broken by the case`))
        : Effect.void;
    });
  const hooks: ShopifyHooksShape = {
    beforeUninstall: (shop) => run("beforeUninstall", `beforeUninstall:${shop}`),
    afterUninstall: (shop) => run("afterUninstall", `afterUninstall:${shop}`),
    beforePlanChange: (shop) => run("beforePlanChange", `beforePlanChange:${shop}`),
    afterPlanRevalidated: ({ shop, changed, next }) =>
      run(
        "afterPlanRevalidated",
        `afterPlanRevalidated:${shop}:changed=${String(changed)}:next=${next?.handle ?? "none"}`,
      ),
  };
  return {
    layer: Layer.succeed(ShopifyHooks, hooks),
    calls: Effect.sync((): readonly string[] => [...calls]),
    breakHook: (hook: HookName) =>
      Effect.sync(() => {
        broken.add(hook);
      }),
  };
};

/**
 * Every line, Debug included, kept for the case; Warning and above also printed, so a failing
 * case still shows its errors.
 */
const capturedLogs = () => {
  const lines: HarnessLogLine[] = [];
  const logger = Logger.make((options) => {
    const { message, logLevel } = options;
    lines.push({
      level: logLevel,
      message: String(Array.isArray(message) ? message[0] : message),
    });
    if (LogLevel.isGreaterThanOrEqualTo(logLevel, "Warn")) Logger.defaultLogger.log(options);
  });
  return {
    layer: Layer.merge(Logger.layer([logger]), Layer.succeed(References.MinimumLogLevel, "All")),
    lines: Effect.sync((): readonly HarnessLogLine[] => [...lines]),
  };
};

/**
 * {@link ShopifyHarness} in this process, with every capability, over both tiers built as an
 * app's Backend builds them but for their backings: `D1Test` (migrated from `migrationsDir`, by
 * default the package's own), `ShopGrantors.layerMemory`, the fake app's credentials,
 * {@link ShopifyFake} installed and {@link PartnerFake} answering the catalog's first handle.
 * `app` is the app's definition, by default the behavior app; the probe topic is added to it.
 * The hooks record each call. Fresh per build.
 */
export const inProcessHarness = (
  options: D1TestOptions & { readonly app?: ShopifyAppDefinition | undefined } = {},
) => {
  const { store, holdWrite } = holdableStore(options);
  const app = behaviorApp(options.app);
  const hooks = recordingHooks();
  const logs = capturedLogs();
  const harness = Layer.effect(
    ShopifyHarness,
    Effect.gen(function* () {
      const shopify = yield* Shopify;
      const gate = yield* MerchantGate;
      const plans = yield* SubscriptionPlan;
      const webhooks = yield* Webhooks;
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
              if (row.planHandleExpiresAt !== undefined && row.planHandleExpiresAt !== null)
                yield* installations.updatePlan({
                  shop: row.shop,
                  planHandle: row.planHandle ?? null,
                  planHandleExpiresAt: row.planHandleExpiresAt,
                  planBoundaryAt: row.planBoundaryAt ?? null,
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
          Effect.map(gate.authenticateMerchant(idToken), ({ shop, shopGid }) => ({
            shop,
            shopGid,
          })),
        gate,
        plans,
        deliver: ({ topic, shop, payload, signed }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const body = JSON.stringify(payload);
              const headers = yield* signWebhook(topic, shop, body);
              const request = new Request(`https://backend.test/webhooks/${topic}`, {
                method: "POST",
                headers:
                  signed === false ? { ...headers, "x-shopify-hmac-sha256": "unsigned" } : headers,
                body,
              });
              const response = yield* webhooks.serve(HttpServerRequest.fromWeb(request));
              return response.status;
            }),
          ),
        hookCalls: hooks.calls,
        breakHook: hooks.breakHook,
        logs: logs.lines,
        ensureSession: shopify.ensureSession,
        adminGraphql: (shop, query) => shopify.adminGraphql(shop, ShopId, query),
        holdWrite,
      };
    }),
  );
  return harness.pipe(
    Layer.provideMerge(ShopifyApp.layerNoDeps(app)),
    Layer.provideMerge(hooks.layer),
    Layer.provideMerge(PartnerFake.layer({ defaultHandle: app.catalog.handles[0] })),
    Layer.provideMerge(ShopifyAccess.layerNoDeps),
    Layer.provideMerge(ShopGrantors.layerMemory),
    Layer.provideMerge(ShopifyClient.layer(FAKE_SHOPIFY_CREDENTIALS)),
    Layer.provideMerge(store),
    Layer.provideMerge(ShopifyFake.layer),
    Layer.provideMerge(logs.layer),
  );
};
