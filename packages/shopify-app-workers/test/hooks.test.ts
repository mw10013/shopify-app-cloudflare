import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ShopifyHooks } from "#internal/hooks.ts";

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
