import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { AppNotInstalledError, ShopifyUnavailableError } from "#internal/contract.ts";
import { crossableDefect } from "#internal/defects.ts";
import {
  EnsureAnswer,
  ExchangeAnswer,
  SHOP_GRANTOR_CLASS,
  type ShopGrantor,
} from "#internal/shop-grantor.ts";

import { at, SHOP, SHOP_GID } from "./fixtures.ts";

/** The name `ShopGrantor` was declared with, as Alchemy's class type carries it. */
type DeclaredName = InstanceType<typeof ShopGrantor>["~alchemy/name"];

/** `true` only while the declared name is exactly `"ShopGrantor"`: the build fails otherwise. */
const declaredExactly: [DeclaredName] extends ["ShopGrantor"]
  ? ["ShopGrantor"] extends [DeclaredName]
    ? true
    : false
  : false = true;

describe("ShopGrantor", () => {
  it("N9: the Durable Object's class name is ShopGrantor, and never changes", () => {
    assert.strictEqual(SHOP_GRANTOR_CLASS, "ShopGrantor");
    assert.isTrue(declaredExactly);
  });

  it("N9: the encoded exchange answers are the shapes both Worker versions read", () => {
    const encode = Schema.encodeSync(ExchangeAnswer);
    assert.deepStrictEqual(encode({ _tag: "Exchanged", shopGid: SHOP_GID }), {
      _tag: "Exchanged",
      shopGid: "gid://shopify/Shop/1",
    });
    assert.deepStrictEqual(
      encode({ _tag: "Refused", error: new ShopifyUnavailableError({ shop: SHOP }) }),
      { _tag: "Refused", error: { _tag: "ShopifyUnavailableError", shop: SHOP } },
    );
  });

  it("N9: the encoded ensure answers are the shapes both Worker versions read", () => {
    const encode = Schema.encodeSync(EnsureAnswer);
    assert.deepStrictEqual(
      encode({
        _tag: "Ensured",
        token: { accessToken: "shpat_a", accessTokenExpiresAt: at(1000) },
      }),
      { _tag: "Ensured", token: { accessToken: "shpat_a", accessTokenExpiresAt: 1000 } },
    );
    assert.deepStrictEqual(
      encode({ _tag: "Refused", error: new AppNotInstalledError({ shop: SHOP }) }),
      { _tag: "Refused", error: { _tag: "AppNotInstalledError", shop: SHOP } },
    );
  });
});

describe("crossableDefect", () => {
  it("keeps each link's name, message, primitive fields and cause, and drops functions", () => {
    const inner = Object.assign(new Error("inner"), { status: 503, check: () => true });
    const outer = Object.assign(new TypeError("outer", { cause: inner }), { shop: SHOP });
    const crossed = crossableDefect(outer);
    assert.strictEqual(crossed.name, "TypeError");
    assert.strictEqual(crossed.message, "outer");
    assert.strictEqual((crossed as Error & { shop?: unknown }).shop, SHOP);
    const cause = crossed.cause as Error & { status?: unknown; check?: unknown };
    assert.strictEqual(cause.message, "inner");
    assert.strictEqual(cause.status, 503);
    assert.isUndefined(cause.check);
    assert.doesNotThrow(() => structuredClone(crossed));
  });

  it("stops at a cycle, after the first link that repeats", () => {
    const looped: Error & { cause?: unknown } = new Error("looped");
    looped.cause = looped;
    const crossed = crossableDefect(looped);
    assert.strictEqual((crossed.cause as Error).message, "looped");
    assert.isUndefined((crossed.cause as Error).cause);
  });
});
