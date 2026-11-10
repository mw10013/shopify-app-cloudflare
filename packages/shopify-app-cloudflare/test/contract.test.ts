import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AccessDeniedError,
  AppNotInstalledError,
  AuthenticateMerchantFailure,
  InvalidIdTokenError,
  MerchantRefusal,
  PlanUnsubscribedError,
  ReauthenticationRequiredError,
  ShopifyAccessFailure,
  ShopifyUnavailableError,
  ShopInaccessibleError,
} from "#internal/contract.ts";

import { SHOP } from "./fixtures.ts";
import { reachedPackages } from "./reach.ts";

describe("/contract", () => {
  it("never reaches @shopify/shopify-api, so the Website can import it", () => {
    const reached = reachedPackages("contract.ts");
    assert.include(reached, "effect/Schema");
    assert.deepStrictEqual(
      reached.filter((specifier) => specifier.startsWith("@shopify/")),
      [],
    );
  });

  it("the import walk does see the library where it is imported", () => {
    assert.include(reachedPackages("backend.ts"), "@shopify/shopify-api/adapters/web-api");
  });
});

describe("ShopifyAccessFailure", () => {
  const failures = [
    new AppNotInstalledError({ shop: SHOP }),
    new ReauthenticationRequiredError({ shop: SHOP, refreshTokenState: "rejected" }),
    new AccessDeniedError({ shop: SHOP }),
    new ShopInaccessibleError({ shop: SHOP, status: 423 }),
    new ShopifyUnavailableError({ shop: SHOP }),
  ];

  it("crosses encoded as { _tag, ...fields } and decodes to the same class", () => {
    const encode = Schema.encodeSync(ShopifyAccessFailure);
    const decode = Schema.decodeUnknownSync(ShopifyAccessFailure);
    for (const failure of failures) {
      const encoded = encode(failure);
      assert.strictEqual((encoded as { _tag: string })._tag, failure._tag);
      const decoded = decode(structuredClone(encoded));
      assert.strictEqual(decoded.constructor, failure.constructor);
      assert.deepStrictEqual(encode(decoded), encoded);
    }
  });

  it("names the shop in every message", () => {
    for (const failure of failures) assert.include(failure.message, SHOP);
  });

  it("refuses a shop that is not a myshopify domain and a status outside 402, 423, 403", () => {
    const decode = Schema.decodeUnknownExit(ShopifyAccessFailure);
    assert.strictEqual(decode({ _tag: "AppNotInstalledError", shop: "x.com" })._tag, "Failure");
    assert.strictEqual(
      decode({ _tag: "ShopInaccessibleError", shop: SHOP, status: 500 })._tag,
      "Failure",
    );
  });
});

describe("the merchant failure schemas", () => {
  it("MerchantRefusal and AuthenticateMerchantFailure decode their members and nothing else", () => {
    const refusal = Schema.decodeUnknownExit(MerchantRefusal);
    const failure = Schema.decodeUnknownExit(AuthenticateMerchantFailure);
    const href = "https://example.com/auth/exit-iframe";
    assert.strictEqual(refusal({ _tag: "InvalidIdTokenError" })._tag, "Success");
    assert.strictEqual(refusal({ _tag: "PlanUnsubscribedError", href })._tag, "Success");
    assert.strictEqual(refusal({ _tag: "ShopifyUnavailableError", shop: SHOP })._tag, "Failure");
    assert.strictEqual(failure({ _tag: "ShopifyUnavailableError", shop: SHOP })._tag, "Success");
    assert.strictEqual(failure({ _tag: "AppNotInstalledError", shop: SHOP })._tag, "Failure");
    assert.isNotEmpty(new InvalidIdTokenError().message);
    assert.isNotEmpty(new PlanUnsubscribedError({ href }).message);
  });
});
