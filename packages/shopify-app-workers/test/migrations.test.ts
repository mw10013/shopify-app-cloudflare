import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { assert, describe, it } from "@effect/vitest";

const dir = new URL("../migrations/", import.meta.url);

// Alchemy refuses a deploy whose applied migration changed by a single byte (RewrittenMigrationHistoryError),
// and every app's D1 has applied these. A new migration adds its line; an existing line never changes.
const applied: Record<string, string> = {
  "0000_swa_01_app_installation.sql":
    "1cc67f9daf028c90bea224b142fe04408b4128214d0e6e6fbe6ebe910910bf19",
  "0000_swa_02_app_installation_installed_at.sql":
    "44839e3439d2adf48ee05ad0d5631ed7c56652c86218e1bd15f2bb7a2d261af5",
};

describe("the package's migrations", () => {
  it("are never edited once released", () => {
    const actual = Object.fromEntries(
      readdirSync(dir)
        .filter((name) => name.endsWith(".sql"))
        .map((name) => [
          name,
          createHash("sha256")
            .update(readFileSync(new URL(name, dir)))
            .digest("hex"),
        ]),
    );
    assert.deepStrictEqual(actual, applied);
  });
});
