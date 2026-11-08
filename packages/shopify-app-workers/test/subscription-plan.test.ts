import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import { PlanCatalog } from "#internal/catalog.ts";
import {
  cachedStatus,
  PLAN_HANDLE_BOUNDARY_SKEW,
  PLAN_HANDLE_MAX_AGE,
  type PlanCacheRow,
  planHandleExpiresAt,
} from "#internal/subscription-plan.ts";

import { at, millisOf, SHOP, SHOP_GID } from "./fixtures.ts";

const catalog = PlanCatalog.make({ "test-basic": {}, "test-pro": {} });
const NOW = at(1_000_000_000);
const hours = (n: number) => DateTime.addDuration(NOW, Duration.hours(n));

const row = (over: Partial<PlanCacheRow>): PlanCacheRow => ({
  shop: SHOP,
  shopGid: SHOP_GID,
  planHandle: null,
  planHandleExpiresAt: null,
  planBoundaryAt: null,
  ...over,
});

describe("planHandleExpiresAt", () => {
  it("is a day ahead with no boundary, or a boundary already past", () => {
    const day = millisOf(DateTime.addDuration(NOW, PLAN_HANDLE_MAX_AGE));
    assert.strictEqual(millisOf(planHandleExpiresAt(NOW, null)), day);
    assert.strictEqual(millisOf(planHandleExpiresAt(NOW, hours(-1))), day);
  });

  it("is clamped to a boundary sooner than a day, plus the skew", () => {
    assert.strictEqual(
      millisOf(planHandleExpiresAt(NOW, hours(2))),
      millisOf(DateTime.addDuration(hours(2), PLAN_HANDLE_BOUNDARY_SKEW)),
    );
    assert.strictEqual(
      millisOf(planHandleExpiresAt(NOW, hours(48))),
      millisOf(DateTime.addDuration(NOW, PLAN_HANDLE_MAX_AGE)),
    );
  });
});

describe("cachedStatus", () => {
  it("misses when never fetched or past its deadline", () => {
    assert.isTrue(Option.isNone(cachedStatus(row({}), NOW, catalog)));
    assert.isTrue(
      Option.isNone(
        cachedStatus(row({ planHandle: "test-basic", planHandleExpiresAt: NOW }), NOW, catalog),
      ),
    );
  });

  it("N5: misses on a handle outside the catalog, though fresh", () => {
    assert.isTrue(
      Option.isNone(
        cachedStatus(
          row({ planHandle: "test-retired", planHandleExpiresAt: hours(1) }),
          NOW,
          catalog,
        ),
      ),
    );
  });

  it("answers a fresh handle with its boundary, and a fresh null as a verified absence", () => {
    assert.deepStrictEqual(
      cachedStatus(
        row({ planHandle: "test-pro", planHandleExpiresAt: hours(1), planBoundaryAt: hours(3) }),
        NOW,
        catalog,
      ),
      Option.some({
        _tag: "Subscribed",
        handle: Option.getOrThrow(catalog.parse("test-pro")),
        boundaryAt: hours(3),
      } as const),
    );
    assert.deepStrictEqual(
      cachedStatus(row({ planHandleExpiresAt: hours(1) }), NOW, catalog),
      Option.some({ _tag: "Unsubscribed" } as const),
    );
  });
});
