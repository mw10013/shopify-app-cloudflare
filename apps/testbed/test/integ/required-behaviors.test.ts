import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { assert } from "@effect/vitest";
import { REQUIRED_BEHAVIORS, SHOPIFY_TEST_DOOR_CAN } from "@mw10013/shopify-app-cloudflare/test";
import * as Effect from "effect/Effect";

import { door } from "./door.ts";
import { fileStage } from "./file-stage.ts";
import Stack from "./stack.ts";

/**
 * Every required behavior inside the test Backend in workerd, through its `ShopifyTestDoor`:
 * against the real D1, migrated from the testbed's `migrations/`. A case that needs what only an
 * in-process harness has (the test clock) is skipped here and runs
 * in the unit suite.
 */
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: fileStage("behaviors"),
});

const stack = beforeAll(deploy(Stack));
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack));

for (const [index, behavior] of REQUIRED_BEHAVIORS.entries()) {
  const name = `${behavior.id}: ${behavior.name}`;
  const missing = behavior.needs.filter((need) => !SHOPIFY_TEST_DOOR_CAN.has(need));
  if (missing.length > 0)
    test.skip(`${name} [in process only: ${missing.join(", ")}]`, Effect.void);
  else
    test(
      name,
      Effect.gen(function* () {
        const { backendUrl } = yield* stack;
        const outcome = yield* door(backendUrl, (client) => client.RunBehavior({ index, name }));
        if (outcome._tag === "Failed") assert.fail(outcome.cause);
      }),
      { timeout: (behavior.timeout ?? 5000) + 10_000 },
    );
}
