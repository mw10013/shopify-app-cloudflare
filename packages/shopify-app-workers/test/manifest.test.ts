import { readFileSync } from "node:fs";

import { assert, describe, it } from "@effect/vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

/** The fields a tagged copy of this manifest hands consumers; devDependencies stay in the workspace. */
const PUBLISHED = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

describe("package.json", () => {
  it("names every published dependency with a literal specifier", () => {
    const workspaceOnly = PUBLISHED.flatMap((field) =>
      Object.entries((manifest[field] ?? {}) as Record<string, string>)
        .filter(([, spec]) => spec.startsWith("catalog:") || spec.startsWith("workspace:"))
        .map(([name, spec]) => `${field}.${name}: ${spec}`),
    );
    assert.deepStrictEqual(workspaceOnly, []);
  });

  it("is a private source manifest under MIT", () => {
    assert.strictEqual(manifest.version, "0.0.0-source");
    assert.strictEqual(manifest.private, true);
    assert.strictEqual(manifest.license, "MIT");
  });
});
