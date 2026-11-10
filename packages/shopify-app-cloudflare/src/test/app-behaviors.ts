/**
 * The required behaviors of tier 2, as data like `AUTH_BEHAVIORS`: the plan check and the
 * merchant gate, the hooks' failure policies, and webhooks (`shopify-auth.md` cases 46–48 and
 * the package's `N…` cases).
 *
 * @module
 */

import assert from "node:assert/strict";

import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ShopDomain, ShopGid } from "#internal/domain.ts";
import { planSelectionHref } from "#internal/merchant-gate.ts";

import {
  assertDefect,
  behavior,
  BEHAVIOR_SHOP,
  BEHAVIOR_SHOP_GID,
  failureOf,
  type RequiredBehavior,
  rowAt,
  seedAt,
  stored,
  storedRow,
} from "./auth-behaviors.ts";
import { BEHAVIOR_PROBE_TOPIC } from "./behavior-app.ts";
import { mintIdToken } from "./id-token.ts";
import { fakePlanSelectionUrl, PartnerFake } from "./partner-fake.ts";
import { ShopifyFake } from "./shopify-fake.ts";
import { type HarnessCapability, ShopifyHarness } from "./shopify-harness.ts";

const SHOP = BEHAVIOR_SHOP;

/** A second shop, for the daily revalidation. */
const OTHER_SHOP = Schema.decodeUnknownSync(ShopDomain)("behavior-other.myshopify.com");
const OTHER_SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/2");

/** A handle no catalog sells: a plan the app retired. */
const RETIRED_HANDLE = "behavior-retired";

const clock: readonly HarnessCapability[] = ["clock"];

/** Seeds the shop with a token fresh for an hour, so the gate makes no exchange. */
const seedFresh = (over: Parameters<typeof seedAt>[0] = {}) =>
  Effect.gen(function* () {
    yield* seedAt({
      accessTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.hours(1)),
      ...over,
    });
  });

/** A plan cache entry fresh for a day, on `handle` (null: a verified absence). */
const cachedPlan = (handle: string | null) =>
  Effect.map(DateTime.now, (now) => ({
    planHandle: handle,
    planHandleExpiresAt: DateTime.addDuration(now, Duration.days(1)),
    planBoundaryAt: null,
  }));

const idToken = mintIdToken({ shop: SHOP });

const gate = Effect.map(ShopifyHarness, (harness) => harness.gate);

const authenticate = (options: { readonly billingRedirect?: boolean } = {}) =>
  Effect.gen(function* () {
    return yield* (yield* gate).authenticateMerchant(yield* idToken, options);
  });

/** The default catalog handle the fake answers with: whatever the gate first stores. */
const defaultHandle = Effect.gen(function* () {
  yield* seedFresh();
  yield* authenticate();
  const row = yield* storedRow;
  assert.ok(row.planHandle !== null, "the fake's default handle is stored");
  return row.planHandle;
});

const asked = Effect.flatMap(PartnerFake, (fake) => fake.asked);
const script = (...args: Parameters<PartnerFake["Service"]["script"]>) =>
  Effect.flatMap(PartnerFake, (fake) => fake.script(...args));
const hookCalls = Effect.flatMap(ShopifyHarness, (harness) => harness.hookCalls);
const breakHook = (hook: Parameters<ShopifyHarness["Service"]["breakHook"]>[0]) =>
  Effect.flatMap(ShopifyHarness, (harness) => harness.breakHook(hook));

/** The lines logged at `level` whose message starts with `prefix`. */
const logged = (level: string, prefix: string) =>
  Effect.map(
    Effect.flatMap(ShopifyHarness, (harness) => harness.logs),
    (lines) => lines.filter((line) => line.level === level && line.message.startsWith(prefix)),
  );

const deliver = (
  topic: string,
  payload: unknown = {},
  options: { readonly signed?: boolean } = {},
) =>
  Effect.flatMap(ShopifyHarness, (harness) =>
    harness.deliver({ topic, shop: SHOP, payload, ...options }),
  );

/** The plan check and the merchant gate. */
const billing: readonly RequiredBehavior[] = [
  behavior(
    "N3",
    "a revalidation logs at Info with the handle",
    Effect.gen(function* () {
      const handle = yield* defaultHandle;
      assert.equal(
        (yield* logged("Info", `SubscriptionPlan.revalidate: shop=${SHOP} handle=${handle}`))
          .length,
        1,
      );
    }),
  ),
  behavior(
    "N5",
    "a stored handle outside the catalog is a cache miss: the Partner API is asked again",
    Effect.gen(function* () {
      yield* seedFresh(yield* cachedPlan(RETIRED_HANDLE));
      yield* authenticate();
      assert.deepEqual(yield* asked, [BEHAVIOR_SHOP_GID]);
      assert.notEqual((yield* storedRow).planHandle, RETIRED_HANDLE);
    }),
  ),
  behavior(
    "N11",
    "a Partner outage is ShopifyUnavailableError, never Unsubscribed, and leaves the cache as it was",
    Effect.gen(function* () {
      yield* seedFresh();
      yield* script(BEHAVIOR_SHOP_GID, { _tag: "Failure", reason: "partner-down" });
      assert.equal(yield* failureOf(authenticate()), "ShopifyUnavailableError");
      assert.equal(
        yield* failureOf(
          Effect.flatMap(idToken, (token) => Effect.flatMap(gate, (g) => g.subscribedShop(token))),
        ),
        "ShopifyUnavailableError",
      );
      assert.equal(
        yield* failureOf(
          Effect.flatMap(idToken, (token) =>
            Effect.flatMap(gate, (g) => g.merchantStanding(token)),
          ),
        ),
        "ShopifyUnavailableError",
      );
      const row = yield* storedRow;
      assert.equal(row.planHandle, null);
      assert.equal(row.planHandleExpiresAt, null);
    }),
  ),
  behavior(
    "N12",
    "a fresh plan cache answers with no Partner call",
    Effect.gen(function* () {
      const handle = yield* defaultHandle;
      yield* authenticate();
      assert.deepEqual(yield* asked, [BEHAVIOR_SHOP_GID]);
      assert.equal((yield* storedRow).planHandle, handle);
    }),
  ),
  behavior(
    "N13",
    "no app subscription: PlanUnsubscribedError through the exit-iframe page, and the absence is cached",
    Effect.gen(function* () {
      yield* seedFresh();
      yield* script(BEHAVIOR_SHOP_GID, { _tag: "None" });
      const error = yield* Effect.flip(authenticate());
      assert.equal(error._tag, "PlanUnsubscribedError");
      assert.equal(
        "href" in error ? error.href : undefined,
        planSelectionHref(fakePlanSelectionUrl(SHOP), SHOP),
      );
      const row = yield* storedRow;
      assert.equal(row.planHandle, null);
      assert.ok(row.planHandleExpiresAt !== null, "a verified absence has a deadline");
      yield* Effect.flip(authenticate());
      assert.equal((yield* asked).length, 1, "the absence answers from the cache");
    }),
  ),
  behavior(
    "N14",
    "the billing redirect re-reads the plan though the cache is fresh",
    Effect.gen(function* () {
      yield* defaultHandle;
      yield* script(BEHAVIOR_SHOP_GID, { _tag: "None" });
      yield* authenticate();
      assert.equal(
        yield* failureOf(authenticate({ billingRedirect: true })),
        "PlanUnsubscribedError",
      );
      assert.equal((yield* asked).length, 2);
    }),
  ),
  behavior(
    "N15",
    "the cache deadline is a day, clamped to the subscription boundary plus 5 minutes",
    Effect.gen(function* () {
      const handle = yield* defaultHandle;
      const now = yield* DateTime.now;
      const boundaryAt = DateTime.addDuration(now, Duration.hours(2));
      yield* script(BEHAVIOR_SHOP_GID, {
        _tag: "Subscribed",
        handle,
        cycleStartAt: now,
        boundaryAt,
      });
      yield* authenticate({ billingRedirect: true });
      const clamped = yield* storedRow;
      assert.deepEqual(
        clamped.planHandleExpiresAt,
        DateTime.addDuration(boundaryAt, Duration.minutes(5)),
      );
      assert.deepEqual(clamped.planBoundaryAt, boundaryAt);
      yield* script(BEHAVIOR_SHOP_GID, {
        _tag: "Subscribed",
        handle,
        cycleStartAt: null,
        boundaryAt: null,
      });
      yield* authenticate({ billingRedirect: true });
      assert.deepEqual(
        (yield* storedRow).planHandleExpiresAt,
        DateTime.addDuration(now, Duration.days(1)),
      );
    }),
    { needs: clock },
  ),
  behavior(
    "N16",
    "the plan is the one catalog handle among the items: a meter beside it is ignored, two plans are no plan",
    Effect.gen(function* () {
      const handle = yield* defaultHandle;
      const now = yield* DateTime.now;
      yield* script(BEHAVIOR_SHOP_GID, {
        _tag: "Subscribed",
        handle: "usage-meter",
        otherHandles: [handle],
        cycleStartAt: now,
        boundaryAt: null,
      });
      yield* authenticate({ billingRedirect: true });
      assert.equal((yield* storedRow).planHandle, handle);
      yield* script(BEHAVIOR_SHOP_GID, {
        _tag: "Subscribed",
        handle,
        otherHandles: [handle],
        cycleStartAt: now,
        boundaryAt: null,
      });
      assert.equal(
        yield* failureOf(authenticate({ billingRedirect: true })),
        "PlanUnsubscribedError",
      );
    }),
  ),
  behavior(
    "N17",
    "afterPlanRevalidated runs on every revalidation; changed is false on the first fetch and on the same handle",
    Effect.gen(function* () {
      const handle = yield* defaultHandle;
      yield* authenticate({ billingRedirect: true });
      yield* script(BEHAVIOR_SHOP_GID, { _tag: "None" });
      yield* Effect.flip(authenticate({ billingRedirect: true }));
      assert.deepEqual(
        (yield* hookCalls).filter((call) => call.startsWith("afterPlanRevalidated")),
        [
          `afterPlanRevalidated:${SHOP}:changed=false:next=${handle}`,
          `afterPlanRevalidated:${SHOP}:changed=false:next=${handle}`,
          `afterPlanRevalidated:${SHOP}:changed=true:next=none`,
        ],
      );
    }),
  ),
  behavior(
    "N18",
    "the Manage plan press shortens the deadline to 15 minutes and runs beforePlanChange; a never-fetched row stays unfetched",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      yield* seedFresh();
      yield* harness.gate.expectPlanChange(yield* idToken);
      assert.equal((yield* storedRow).planHandleExpiresAt, null);
      yield* authenticate();
      yield* harness.gate.expectPlanChange(yield* idToken);
      assert.deepEqual(
        (yield* storedRow).planHandleExpiresAt,
        DateTime.addDuration(yield* DateTime.now, Duration.minutes(15)),
      );
      assert.deepEqual(
        (yield* hookCalls).filter((call) => call.startsWith("beforePlanChange")),
        [`beforePlanChange:${SHOP}`, `beforePlanChange:${SHOP}`],
      );
    }),
    { needs: clock },
  ),
  behavior(
    "N19",
    "the daily revalidation reads every stale shop, and one shop's outage does not stop the others",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      const now = yield* DateTime.now;
      yield* harness.seed(rowAt(now));
      yield* harness.seed(rowAt(now, { shop: OTHER_SHOP, shopGid: OTHER_SHOP_GID }));
      yield* script(OTHER_SHOP_GID, { _tag: "Failure", reason: "partner-down" });
      assert.deepEqual(yield* harness.plans.revalidateStalePlans, { shops: 2, failed: 1 });
      assert.ok((yield* storedRow).planHandleExpiresAt !== null);
      assert.deepEqual(yield* harness.plans.revalidateStalePlans, { shops: 1, failed: 1 });
      assert.deepEqual(
        (yield* asked).toSorted(),
        [BEHAVIOR_SHOP_GID, OTHER_SHOP_GID, OTHER_SHOP_GID].toSorted(),
      );
    }),
  ),
  behavior(
    "N20",
    "a screen read answers the handle without exchanging; with no row it is a defect",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      yield* assertDefect(harness.gate.subscribedShop(yield* idToken));
      yield* seedAt();
      const read = yield* harness.gate.subscribedShop(yield* idToken);
      assert.equal(read.shop, SHOP);
      assert.equal(read.handle, (yield* storedRow).planHandle);
      assert.deepEqual(read.installedAt, (yield* storedRow).installedAt);
      assert.deepEqual((yield* (yield* ShopifyFake).calls).length, 0, "no exchange");
    }),
  ),
  behavior(
    "N21",
    "the socket gate's read: the verified shop needs no row, unsubscribed is data, no row is AppNotInstalledError",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      assert.equal(yield* harness.gate.verifiedShop(yield* idToken), SHOP);
      assert.equal(
        yield* failureOf(harness.gate.verifiedShop("not-a-token")),
        "InvalidIdTokenError",
      );
      assert.equal(
        yield* failureOf(harness.gate.merchantStanding(yield* idToken)),
        "AppNotInstalledError",
      );
      yield* seedAt();
      yield* script(BEHAVIOR_SHOP_GID, { _tag: "None" });
      assert.deepEqual(yield* harness.gate.merchantStanding(yield* idToken), {
        shop: SHOP,
        shopGid: BEHAVIOR_SHOP_GID,
        status: { _tag: "Unsubscribed" },
      });
    }),
  ),
];

/** Each hook's failure policy (N4): only `afterUninstall` fails its caller. */
const hookPolicies: readonly RequiredBehavior[] = [
  behavior(
    "N4",
    "a beforeUninstall defect is logged and swallowed: the uninstall goes on",
    Effect.gen(function* () {
      yield* seedAt();
      yield* breakHook("beforeUninstall");
      assert.equal(yield* deliver("app/uninstalled"), 200);
      assert.ok(Option.isNone(yield* stored));
      assert.deepEqual(yield* hookCalls, [`beforeUninstall:${SHOP}`, `afterUninstall:${SHOP}`]);
      assert.equal((yield* logged("Warn", "ShopifyHooks.beforeUninstall")).length, 1);
    }),
  ),
  behavior(
    "N4",
    "an afterUninstall defect fails the webhook (500, at Error); the redelivery succeeds",
    Effect.gen(function* () {
      yield* seedAt();
      yield* breakHook("afterUninstall");
      assert.equal(yield* deliver("app/uninstalled"), 500);
      assert.ok(Option.isNone(yield* stored));
      assert.equal((yield* logged("Error", "Webhooks.handle")).length, 1);
      assert.equal(yield* deliver("app/uninstalled"), 200);
    }),
  ),
  behavior(
    "N4",
    "a beforePlanChange defect is logged and swallowed: the deadline is still shortened",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      yield* defaultHandle;
      const before = (yield* storedRow).planHandleExpiresAt;
      yield* breakHook("beforePlanChange");
      yield* harness.gate.expectPlanChange(yield* idToken);
      const after = (yield* storedRow).planHandleExpiresAt;
      assert.ok(before !== null && after !== null && DateTime.isLessThan(after, before));
      assert.equal((yield* logged("Warn", "ShopifyHooks.beforePlanChange")).length, 1);
    }),
  ),
  behavior(
    "N4",
    "an afterPlanRevalidated defect is logged and swallowed: the gate answers and the cache is written",
    Effect.gen(function* () {
      yield* seedFresh();
      yield* breakHook("afterPlanRevalidated");
      yield* authenticate();
      assert.ok((yield* storedRow).planHandle !== null);
      assert.equal((yield* logged("Warn", "ShopifyHooks.afterPlanRevalidated")).length, 1);
    }),
  ),
];

/** Webhooks: the answer table, the built-in topics and dispatch. */
const webhooks: readonly RequiredBehavior[] = [
  ...(
    [
      [
        "ReauthenticationRequiredError",
        Effect.gen(function* () {
          yield* seedAt({ refreshToken: null, refreshTokenExpiresAt: null });
        }),
      ],
      [
        "AccessDeniedError",
        Effect.gen(function* () {
          yield* seedFresh();
          yield* (yield* ShopifyFake).script([
            {
              route: "graphql",
              body: {
                errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }],
              },
            },
          ]);
        }),
      ],
      [
        "ShopInaccessibleError",
        Effect.gen(function* () {
          yield* seedFresh();
          yield* (yield* ShopifyFake).script([
            { route: "graphql", status: 402, body: { errors: "frozen" } },
          ]);
        }),
      ],
    ] as const
  ).map(([error, arrange]) =>
    behavior(
      "46",
      `a handler meeting ${error}: 200 and a Warning`,
      Effect.gen(function* () {
        yield* arrange;
        assert.equal(yield* deliver(BEHAVIOR_PROBE_TOPIC), 200);
        assert.equal(
          (yield* logged(
            "Warn",
            `Webhooks.handle: shop=${SHOP} topic=${BEHAVIOR_PROBE_TOPIC} error=${error}`,
          )).length,
          1,
        );
      }),
    ),
  ),
  behavior(
    "47",
    "a handler meeting ShopifyUnavailableError: 503, so Shopify redelivers, and a Warning",
    Effect.gen(function* () {
      yield* seedFresh();
      yield* (yield* ShopifyFake).script([
        { route: "graphql", status: 503, body: { errors: "down" } },
      ]);
      assert.equal(yield* deliver(BEHAVIOR_PROBE_TOPIC), 503);
      assert.equal(
        (yield* logged(
          "Warn",
          `Webhooks.handle: shop=${SHOP} topic=${BEHAVIOR_PROBE_TOPIC} error=ShopifyUnavailableError`,
        )).length,
        1,
      );
    }),
  ),
  behavior(
    "N22",
    "a handler meeting AppNotInstalledError: 200 at Debug",
    Effect.gen(function* () {
      assert.equal(yield* deliver(BEHAVIOR_PROBE_TOPIC), 200);
      assert.equal(
        (yield* logged(
          "Debug",
          `Webhooks.handle: shop=${SHOP} topic=${BEHAVIOR_PROBE_TOPIC} error=AppNotInstalledError`,
        )).length,
        1,
      );
    }),
  ),
  behavior(
    "48",
    "app/uninstalled delivered twice, and for a shop with no row: 200 each time; no row afterwards",
    Effect.gen(function* () {
      yield* seedAt();
      assert.equal(yield* deliver("app/uninstalled"), 200);
      assert.equal(yield* deliver("app/uninstalled"), 200);
      assert.ok(Option.isNone(yield* stored));
      const harness = yield* ShopifyHarness;
      assert.equal(
        yield* harness.deliver({ topic: "app/uninstalled", shop: OTHER_SHOP, payload: {} }),
        200,
      );
      assert.deepEqual(yield* hookCalls, [
        `beforeUninstall:${SHOP}`,
        `afterUninstall:${SHOP}`,
        `beforeUninstall:${SHOP}`,
        `afterUninstall:${SHOP}`,
        `beforeUninstall:${OTHER_SHOP}`,
        `afterUninstall:${OTHER_SHOP}`,
      ]);
    }),
  ),
  behavior(
    "N23",
    "a topic with no handler and a valid HMAC: 404, logged at Error",
    Effect.gen(function* () {
      assert.equal(yield* deliver("orders/create"), 404);
      assert.equal(
        (yield* logged("Error", `Webhooks.handle: shop=${SHOP} topic=orders/create`)).length,
        1,
      );
    }),
  ),
  behavior(
    "N24",
    "the compliance topics answer 200 and touch nothing",
    Effect.gen(function* () {
      yield* seedAt();
      const before = yield* storedRow;
      for (const topic of ["customers/data_request", "customers/redact", "shop/redact"])
        assert.equal(yield* deliver(topic, { shop_domain: SHOP }), 200, topic);
      assert.deepEqual(yield* storedRow, before);
      assert.deepEqual(yield* hookCalls, []);
    }),
  ),
  behavior(
    "N25",
    "app/scopes_update rewrites the stored scope; a payload without current is 400",
    Effect.gen(function* () {
      yield* seedAt();
      assert.equal(
        yield* deliver("app/scopes_update", { current: ["read_orders", "write_orders"] }),
        200,
      );
      assert.equal((yield* storedRow).scope, "read_orders,write_orders");
      assert.equal(yield* deliver("app/scopes_update", { previous: [] }), 400);
      assert.equal((yield* storedRow).scope, "read_orders,write_orders");
    }),
  ),
  behavior(
    "N26",
    "a delivery whose HMAC fails: 401, logged at Error, and no handler runs",
    Effect.gen(function* () {
      yield* seedAt();
      assert.equal(yield* deliver("app/uninstalled", {}, { signed: false }), 401);
      assert.ok(Option.isSome(yield* stored));
      assert.equal((yield* logged("Error", "ShopifyClient.validateWebhook")).length, 1);
    }),
  ),
];

/**
 * Every tier 2 case: the plan check and the gate (N3, N5, N11–N21), the hooks' policies (N4)
 * and webhooks (46–48, N22–N26).
 */
export const APP_BEHAVIORS: readonly RequiredBehavior[] = [
  ...billing,
  ...hookPolicies,
  ...webhooks,
];
