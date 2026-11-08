import { assert, describe, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { ID_MAX_LENGTH, PlanHandle, ShopDomain, ShopGid } from "#internal/domain.ts";

describe("ShopDomain", () => {
  const decode = Schema.decodeUnknownExit(ShopDomain);

  it("decodes a myshopify domain", () => {
    for (const shop of ["a.myshopify.com", "mw10013-dev-shop-00.myshopify.com", "0.myshopify.com"])
      assert.isTrue(Exit.isSuccess(decode(shop)), shop);
  });

  it("refuses anything else, since the value also arrives in URL paths", () => {
    for (const shop of [
      "",
      "a.myshopify.com.evil.com",
      "A.myshopify.com",
      "-a.myshopify.com",
      "a.shopify.com",
      "../a.myshopify.com",
      "a/b.myshopify.com",
      `${"a".repeat(64)}.myshopify.com`,
      42,
    ])
      assert.isTrue(Exit.isFailure(decode(shop)), String(shop));
  });
});

describe("ShopGid", () => {
  it("is non-empty and at most ID_MAX_LENGTH characters", () => {
    const decode = Schema.decodeUnknownExit(ShopGid);
    assert.isTrue(Exit.isSuccess(decode("gid://shopify/Shop/1")));
    assert.isTrue(Exit.isSuccess(decode("a".repeat(ID_MAX_LENGTH))));
    assert.isTrue(Exit.isFailure(decode("")));
    assert.isTrue(Exit.isFailure(decode("a".repeat(ID_MAX_LENGTH + 1))));
  });
});

describe("PlanHandle", () => {
  it("is any non-empty string: the catalog, not the schema, decides what the app sells", () => {
    const decode = Schema.decodeUnknownExit(PlanHandle);
    assert.isTrue(Exit.isSuccess(decode("baton-enterprise")));
    assert.isTrue(Exit.isFailure(decode("")));
  });
});
