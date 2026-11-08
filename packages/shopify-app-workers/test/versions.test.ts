import { assert, describe, it } from "@effect/vitest";
import { ApiVersion } from "@shopify/shopify-api";

import { ADMIN_API_VERSION } from "#internal/versions.ts";

describe("ADMIN_API_VERSION", () => {
  it("is the library's ApiVersion.October26, the version the package pins", () => {
    assert.strictEqual(ADMIN_API_VERSION, ApiVersion.October26);
  });
});
