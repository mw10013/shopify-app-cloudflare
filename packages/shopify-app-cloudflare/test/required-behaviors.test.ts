import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { APP_BEHAVIORS } from "#test/app-behaviors.ts";
import { AUTH_BEHAVIORS } from "#test/auth-behaviors.ts";
import { inProcessHarness } from "#test/node/shopify-harness.ts";
import { REQUIRED_BEHAVIORS } from "#test/required-behaviors.ts";

describe("REQUIRED_BEHAVIORS", () => {
  it("is every authentication case, then every app case, each test name once", () => {
    assert.deepStrictEqual(REQUIRED_BEHAVIORS, [...AUTH_BEHAVIORS, ...APP_BEHAVIORS]);
    // An id is the spec's case number, which a case's variants share; the name tells them apart.
    const names = REQUIRED_BEHAVIORS.map(({ id, name }) => `${id}: ${name}`);
    assert.deepStrictEqual(
      names.filter((name, index) => names.indexOf(name) !== index),
      [],
    );
  });
});

/** Every required case over the in-process harness: real SQL and both fakes. */
describe("required behavior (in process)", () => {
  for (const behavior of REQUIRED_BEHAVIORS) {
    // The harness keeps every line for the case and prints Warning and above.
    const run = () => behavior.run.pipe(Effect.provide(inProcessHarness()));
    const name = `${behavior.id}: ${behavior.name}`;
    const options = { timeout: behavior.timeout ?? 5000 };
    if (behavior.needs.includes("clock")) it.effect(name, run, options);
    else it.live(name, run, options);
  }
});
