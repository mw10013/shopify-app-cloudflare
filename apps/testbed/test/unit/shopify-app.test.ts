import { fileURLToPath } from "node:url";

import { describe, it } from "@effect/vitest";
import { REQUIRED_BEHAVIORS } from "@mw10013/shopify-app-cloudflare/test";
import {
  expectMigrationsSynced,
  expectTomlMatches,
  inProcessHarness,
} from "@mw10013/shopify-app-cloudflare/test/node";
import * as Effect from "effect/Effect";

import { testbedApp } from "#backend/app.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));

describe("the testbed's wiring", () => {
  it("migrations/ holds the package's migrations byte for byte", () => {
    expectMigrationsSynced({ migrationsDir });
  });

  it("shopify.app.toml subscribes exactly the package's topics and the testbed's, at the pinned version", () => {
    expectTomlMatches({
      tomlPath: fileURLToPath(new URL("../../shopify.app.toml", import.meta.url)),
      app: testbedApp,
    });
  });
});

/** Every required case over the testbed's own catalog, topics and migrations. */
describe("required behavior (in process, the testbed's app)", () => {
  for (const behavior of REQUIRED_BEHAVIORS) {
    const run = () =>
      behavior.run.pipe(Effect.provide(inProcessHarness({ app: testbedApp, migrationsDir })));
    const name = `${behavior.id}: ${behavior.name}`;
    const options = { timeout: behavior.timeout ?? 5000 };
    if (behavior.needs.includes("clock")) it.effect(name, run, options);
    else it.live(name, run, options);
  }
});
