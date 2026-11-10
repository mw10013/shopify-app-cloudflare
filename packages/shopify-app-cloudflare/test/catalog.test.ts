import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AppSubscription, PlanCatalog, PlanStatus } from "#internal/catalog.ts";

import { at, millisOf } from "./fixtures.ts";

const catalog = PlanCatalog.make({
  "baton-basic": { plan: "basic", ordersPerCycle: 200 },
  "baton-pro": { plan: "pro", ordersPerCycle: 1500 },
});

describe("PlanCatalog", () => {
  it("lists its handles and answers each one's entry", () => {
    assert.deepStrictEqual<readonly string[]>(catalog.handles, ["baton-basic", "baton-pro"]);
    const pro = Option.getOrThrow(catalog.parse("baton-pro"));
    assert.deepStrictEqual(catalog.entry(pro), { plan: "pro", ordersPerCycle: 1500 });
  });

  it("parses a handle outside the catalog, an empty one or null as a cache miss", () => {
    assert.isTrue(Option.isNone(catalog.parse("baton-enterprise")));
    assert.isTrue(Option.isNone(catalog.parse("")));
    assert.isTrue(Option.isNone(catalog.parse(null)));
  });

  it("refuses an empty catalog or an empty handle at make", () => {
    assert.throws(() => PlanCatalog.make({}), /no plan/u);
    assert.throws(() => PlanCatalog.make({ "": {} }), /not a plan handle/u);
  });
});

describe("PlanStatus and AppSubscription", () => {
  it("cross with their instants as epoch milliseconds", () => {
    const handle = Option.getOrThrow(catalog.parse("baton-basic"));
    const encoded = Schema.encodeSync(PlanStatus)({
      _tag: "Subscribed",
      handle,
      boundaryAt: at(5000),
    });
    assert.deepStrictEqual(encoded, {
      _tag: "Subscribed",
      handle: "baton-basic",
      boundaryAt: 5000,
    });
    assert.deepStrictEqual(Schema.decodeUnknownSync(PlanStatus)({ _tag: "Unsubscribed" }), {
      _tag: "Unsubscribed",
    });
    const subscription = Schema.decodeUnknownSync(AppSubscription)({
      handle: "baton-basic",
      boundaryAt: null,
      cycleStartAt: 1000,
    });
    assert.strictEqual(millisOf(subscription.cycleStartAt), 1000);
    assert.isNull(subscription.boundaryAt);
  });
});
