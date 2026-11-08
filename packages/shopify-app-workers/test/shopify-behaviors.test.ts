import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { AUTH_BEHAVIORS } from "#test/auth-behaviors.ts";
import { inProcessHarness } from "#test/node/shopify-harness.ts";

/** Every authentication case over the in-process harness: real SQL, grantors in memory, the fake. */
describe("required behavior: authentication (in process)", () => {
  for (const behavior of AUTH_BEHAVIORS) {
    // The harness keeps every line for the case and prints Warning and above.
    const run = () => behavior.run.pipe(Effect.provide(inProcessHarness()));
    const name = `${behavior.id}: ${behavior.name}`;
    const options = { timeout: behavior.timeout ?? 5000 };
    if (behavior.needs.includes("clock")) it.effect(name, run, options);
    else it.live(name, run, options);
  }
});
