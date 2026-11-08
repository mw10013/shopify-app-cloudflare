import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";

import { AUTH_BEHAVIORS } from "#test/auth-behaviors.ts";
import { inProcessHarness } from "#test/node/shopify-harness.ts";

/** Warnings and errors only: a grant's Info lines would bury a failure's output. */
const QuietLogs = Layer.succeed(References.MinimumLogLevel, "Warn");

/** Every authentication case over the in-process harness: real SQL, grantors in memory, the fake. */
describe("required behavior: authentication (in process)", () => {
  for (const behavior of AUTH_BEHAVIORS) {
    const run = () =>
      behavior.run.pipe(Effect.provide(inProcessHarness()), Effect.provide(QuietLogs));
    const name = `${behavior.id}: ${behavior.name}`;
    const options = { timeout: behavior.timeout ?? 5000 };
    if (behavior.needs.includes("clock")) it.effect(name, run, options);
    else it.live(name, run, options);
  }
});
