/**
 * The parts of a {@link ShopifyHarness} that every harness builds the same way, in process or
 * in a test Backend in workerd: seeding a row, uninstalling, recording the hooks and keeping
 * the lines a case logs.
 *
 * @module
 */

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as References from "effect/References";

import type { AppInstallationStore } from "#internal/app-installation-store.ts";
import type { ShopDomain } from "#internal/domain.ts";
import { ShopifyHooks, type ShopifyHooksShape } from "#internal/hooks.ts";
import type { Webhooks } from "#internal/webhooks.ts";

import { FAKE_SCOPE, type ShopifyFake } from "./shopify-fake.ts";
import type {
  HarnessDelivery,
  HarnessLogLine,
  HookName,
  SeedInstallation,
} from "./shopify-harness.ts";
import { signWebhook } from "./webhook.ts";

/**
 * Stores `row` as a mint would: inserted, or its token written over an existing row. A row from
 * the refresh design is `legacy`'s to write, since no store method writes a refresh token. Unless
 * `installed` is false, the fake installs the app on the shop and recognizes the seeded token.
 */
export const seedInstallation = (
  installations: AppInstallationStore["Service"],
  fake: ShopifyFake["Service"],
  row: SeedInstallation,
  legacy: (row: SeedInstallation) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const token = {
      scope: row.scope ?? FAKE_SCOPE,
      accessToken: row.accessToken ?? null,
      accessTokenExpiresAt: row.accessTokenExpiresAt ?? null,
    };
    const inserted = yield* installations.insert({
      shop: row.shop,
      shopGid: row.shopGid,
      ...token,
    });
    if (!inserted && token.accessToken !== null && token.accessTokenExpiresAt !== null)
      yield* installations.updateToken(row.shop, {
        ...token,
        accessToken: token.accessToken,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
      });
    if ((row.refreshToken ?? row.refreshTokenExpiresAt ?? null) !== null) yield* legacy(row);
    if (row.planHandleExpiresAt !== undefined && row.planHandleExpiresAt !== null)
      yield* installations.updatePlan({
        shop: row.shop,
        planHandle: row.planHandle ?? null,
        planHandleExpiresAt: row.planHandleExpiresAt,
        planBoundaryAt: row.planBoundaryAt ?? null,
      });
    if (row.installed === false) return;
    yield* fake.install(row.shop, token.scope);
    if (token.accessToken !== null && token.accessTokenExpiresAt !== null)
      yield* fake.recognize(
        row.shop,
        token.accessToken,
        DateTime.toEpochMillis(token.accessTokenExpiresAt),
      );
  });

/** Shopify uninstalls the app from `shop`, then `app/uninstalled`'s delete runs. */
export const uninstall = (
  installations: AppInstallationStore["Service"],
  fake: ShopifyFake["Service"],
  shop: ShopDomain,
) => Effect.andThen(fake.uninstall(shop), installations.delete(shop));

/**
 * Hooks that record each call, and die once on a hook a case broke; `reset` forgets both. A call
 * not broken runs `app`'s hook, so an app's own hooks (its shop actors') still run under the
 * recording.
 */
export const recordingHooks = (app: ShopifyHooksShape = ShopifyHooks.noop) => {
  const calls: string[] = [];
  const broken = new Set<HookName>();
  const run = (hook: HookName, call: string, then: Effect.Effect<void>) =>
    Effect.suspend(() => {
      calls.push(call);
      return broken.delete(hook) ? Effect.die(new Error(`${hook}: broken by the case`)) : then;
    });
  const hooks: ShopifyHooksShape = {
    beforeUninstall: (shop) =>
      run("beforeUninstall", `beforeUninstall:${shop}`, app.beforeUninstall(shop)),
    afterUninstall: (shop) =>
      run("afterUninstall", `afterUninstall:${shop}`, app.afterUninstall(shop)),
    beforePlanChange: (shop) =>
      run("beforePlanChange", `beforePlanChange:${shop}`, app.beforePlanChange(shop)),
    afterPlanRevalidated: (revalidation) =>
      run(
        "afterPlanRevalidated",
        `afterPlanRevalidated:${revalidation.shop}:changed=${String(revalidation.changed)}:next=${revalidation.next?.handle ?? "none"}`,
        app.afterPlanRevalidated(revalidation),
      ),
  };
  return {
    layer: Layer.succeed(ShopifyHooks, hooks),
    calls: Effect.sync((): readonly string[] => [...calls]),
    breakHook: (hook: HookName) =>
      Effect.sync(() => {
        broken.add(hook);
      }),
    reset: Effect.sync(() => {
      calls.length = 0;
      broken.clear();
    }),
  };
};

/**
 * Every line, Debug included, kept for the case, with the level Effect logged it at; Warning
 * and above also printed, so a failing case still shows its errors.
 */
export const capturedLogs = () => {
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

/** POSTs a delivery, signed as Shopify signs one unless `signed` is false, to `Webhooks.serve`: its status. */
export const deliverTo =
  (webhooks: Webhooks["Service"]) =>
  ({ topic, shop, payload, signed }: HarnessDelivery) =>
    Effect.scoped(
      Effect.gen(function* () {
        const body = JSON.stringify(payload);
        const headers = yield* signWebhook(topic, shop, body);
        const request = new Request(`https://backend.test/webhooks/${topic}`, {
          method: "POST",
          headers: signed === false ? { ...headers, "x-shopify-hmac-sha256": "unsigned" } : headers,
          body,
        });
        const response = yield* webhooks.serve(HttpServerRequest.fromWeb(request));
        return response.status;
      }),
    );
