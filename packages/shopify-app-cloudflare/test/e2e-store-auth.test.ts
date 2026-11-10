import { assert, describe, it } from "@effect/vitest";

import { missingScopes, resultText } from "#test/e2e/store-auth.ts";

describe("missingScopes", () => {
  it("counts a write scope as its read scope", () => {
    assert.deepStrictEqual(missingScopes(["read_products"], ["write_products"]), []);
  });

  it("names every wanted scope the session lacks", () => {
    assert.deepStrictEqual(missingScopes(["read_products", "read_orders"], ["read_orders"]), [
      "read_products",
    ]);
  });
});

describe("resultText", () => {
  it("takes the last pretty-printed object after the progress events", () => {
    const stdout = ['{"event":"start"}', "{", '  "sessions": []', "}", ""].join("\n");
    assert.strictEqual(resultText(stdout), '{\n  "sessions": []\n}');
  });

  it("takes a one-line result as it is", () => {
    assert.strictEqual(resultText('{"event":"start"}\n{"sessions":[]}\n'), '{"sessions":[]}');
  });
});
