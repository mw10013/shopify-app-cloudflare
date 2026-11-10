import { assert, describe, it } from "@effect/vitest";
import { scheduledJob } from "@mw10013/shopify-app-cloudflare/backend";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { capturingLogs, type Logged } from "./logs.ts";

describe("scheduledJob", () => {
  it.effect("a job that fails or dies succeeds, its failure logged once at Error", () =>
    Effect.gen(function* () {
      for (const failing of [
        Effect.fail(new Error("D1 is gone")),
        Effect.die(new Error("D1 is gone")),
      ]) {
        const logged: Logged[] = [];
        const exit = yield* Effect.exit(scheduledJob("revalidateStalePlans", failing)).pipe(
          capturingLogs(logged),
        );
        assert.isTrue(Exit.isSuccess(exit));
        assert.deepStrictEqual(logged, [
          {
            level: "Error",
            message: "Backend.scheduled: job=revalidateStalePlans status=failed",
          },
        ]);
      }
    }),
  );

  it.effect("a job that succeeds logs nothing of its own, and the next job runs", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const ran: string[] = [];
      yield* Effect.gen(function* () {
        yield* scheduledJob("first", Effect.die(new Error("boom")));
        yield* scheduledJob(
          "second",
          Effect.sync(() => {
            ran.push("second");
          }),
        );
      }).pipe(capturingLogs(logged));
      assert.deepStrictEqual(ran, ["second"]);
      assert.deepStrictEqual(
        logged.map(({ message }) => message),
        ["Backend.scheduled: job=first status=failed"],
      );
    }),
  );
});
