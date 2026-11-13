import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { APP_BEHAVIORS } from "#test/app-behaviors.ts";
import { AUTH_BEHAVIORS } from "#test/auth-behaviors.ts";
import { inProcessHarness } from "#test/node/shopify-harness.ts";
import { REQUIRED_BEHAVIORS } from "#test/required-behaviors.ts";

describe("REQUIRED_BEHAVIORS", () => {
  it("is every authentication case, then every app case, each test name once", () => {
    assert.deepStrictEqual(REQUIRED_BEHAVIORS, [...AUTH_BEHAVIORS, ...APP_BEHAVIORS]);
    const names = REQUIRED_BEHAVIORS.map(({ id, name }) => `${id}: ${name}`);
    assert.deepStrictEqual(
      names.filter((name, index) => names.indexOf(name) !== index),
      [],
    );
  });
});

describe("required behavior (in process)", () => {
  for (const behavior of REQUIRED_BEHAVIORS) {
    const run = () => behavior.run.pipe(Effect.provide(inProcessHarness()));
    const name = `${behavior.id}: ${behavior.name}`;
    const options = { timeout: behavior.timeout ?? 5000 };
    if (behavior.needs.includes("clock")) it.effect(name, run, options);
    else it.live(name, run, options);
  }
});
