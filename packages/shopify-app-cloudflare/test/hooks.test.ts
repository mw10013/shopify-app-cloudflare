import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { bestEffort, ShopifyHooks } from "#internal/hooks.ts";

import { SHOP, SHOP_GID } from "./fixtures.ts";

describe("ShopifyHooks.layerNoop", () => {
  it.effect("every hook succeeds and does nothing", () =>
    Effect.gen(function* () {
      const hooks = yield* ShopifyHooks;
      yield* hooks.beforeUninstall(SHOP);
      yield* hooks.afterUninstall(SHOP);
      yield* hooks.beforePlanChange(SHOP);
      yield* hooks.afterPlanRevalidated({
        shop: SHOP,
        shopGid: SHOP_GID,
        previous: null,
        next: null,
        changed: false,
      });
      assert.deepStrictEqual(Object.keys(hooks).toSorted(), [
        "afterPlanRevalidated",
        "afterUninstall",
        "beforePlanChange",
        "beforeUninstall",
      ]);
    }).pipe(Effect.provide(ShopifyHooks.layerNoop)),
  );
});

describe("bestEffort", () => {
  const hooks = ["beforeUninstall", "beforePlanChange", "afterPlanRevalidated"] as const;

  it.effect("swallows a hook's defect and failure", () =>
    Effect.gen(function* () {
      for (const hook of hooks) {
        yield* bestEffort(hook, SHOP, Effect.die(new Error("boom")));
        yield* bestEffort(hook, SHOP, Effect.fail("no") as Effect.Effect<never>);
      }
    }),
  );

  it.effect("propagates an interruption", () =>
    Effect.gen(function* () {
      for (const hook of hooks) {
        const exit = yield* Effect.exit(bestEffort(hook, SHOP, Effect.interrupt));
        assert.isTrue(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause), hook);
      }
    }),
  );
});
