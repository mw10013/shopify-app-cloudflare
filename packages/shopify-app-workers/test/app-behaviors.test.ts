import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { APP_BEHAVIORS } from "#test/app-behaviors.ts";
import { inProcessHarness } from "#test/node/shopify-harness.ts";

/** Every tier 2 case over the in-process harness: real SQL, grantors in memory, both fakes. */
describe("required behavior: billing, the merchant gate, hooks and webhooks (in process)", () => {
  for (const behavior of APP_BEHAVIORS) {
    const run = () => behavior.run.pipe(Effect.provide(inProcessHarness()));
    const name = `${behavior.id}: ${behavior.name}`;
    const options = { timeout: behavior.timeout ?? 5000 };
    if (behavior.needs.includes("clock")) it.effect(name, run, options);
    else it.live(name, run, options);
  }
});
