import { readFileSync } from "node:fs";

import { assert, describe, it } from "@effect/vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

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

  it("is a private source manifest under MIT that holds the release's version", () => {
    assert.match(String(manifest.version), /^\d+\.\d+\.\d+$/u);
    assert.strictEqual(manifest.private, true);
    assert.strictEqual(manifest.license, "MIT");
  });
});
