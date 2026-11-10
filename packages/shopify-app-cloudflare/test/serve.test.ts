import { assert, describe, it } from "@effect/vitest";
import {
  AppNotInstalledError,
  InvalidIdTokenError,
  PlanUnsubscribedError,
  serve,
  serveAll,
} from "@mw10013/shopify-app-cloudflare/backend";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { SHOP } from "./fixtures.ts";
import { capturingLogs, type Logged } from "./logs.ts";

/** What crossed: the failure's value as the caller would receive it. */
const crossed = <A, E>(effect: Effect.Effect<A, E>, logged: Logged[]) =>
  Effect.exit(effect).pipe(
    capturingLogs(logged),
    Effect.map((exit) => {
      assert.isTrue(Exit.isFailure(exit));
      return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
    }),
  );

describe("serve", () => {
  it.effect("a declared failure crosses as its plain encoded fields, not logged", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const failure = yield* crossed(
        serve(
          "authenticateMerchant",
          Effect.fail(new PlanUnsubscribedError({ href: "/plans" })),
          PlanUnsubscribedError,
        ),
        logged,
      );
      assert.deepStrictEqual(failure, { _tag: "PlanUnsubscribedError", href: "/plans" });
      assert.notInstanceOf(failure, Error);
      assert.deepStrictEqual(logged, []);
    }),
  );

  it.effect("an internal error the method dies on crosses as an Error named for it", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const defect = yield* crossed(
        serve("homePlan", Effect.die(new AppNotInstalledError({ shop: SHOP }))),
        logged,
      );
      assert.instanceOf(defect, Error);
      assert.strictEqual(
        defect.message,
        `AppNotInstalledError: ${new AppNotInstalledError({ shop: SHOP }).message}`,
      );
      assert.notProperty(defect, "_tag");
    }),
  );

  it.effect("a defect crosses as an Error of its message and is logged once at Error", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const defect = yield* crossed(
        serve("homePlan", Effect.die(new Error("storage is gone"))),
        logged,
      );
      assert.instanceOf(defect, Error);
      assert.strictEqual(defect.message, "storage is gone");
      assert.deepStrictEqual(logged, [
        { level: "Error", message: "Backend.serve: method=homePlan status=failed" },
      ]);
    }),
  );
});

describe("serveAll", () => {
  it.effect("serves each method under its name with its own entry", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const served = serveAll(
        {
          authenticateMerchant: (idToken: string) =>
            idToken === "bad"
              ? Effect.fail(new InvalidIdTokenError())
              : Effect.succeed({ shop: SHOP }),
          ping: () => Effect.succeed("pong"),
        },
        {
          authenticateMerchant: Schema.Union([InvalidIdTokenError, PlanUnsubscribedError]),
          ping: Schema.Never,
        },
      );
      assert.deepStrictEqual(yield* served.authenticateMerchant("good"), { shop: SHOP });
      assert.strictEqual(yield* served.ping(), "pong");
      assert.deepStrictEqual(yield* crossed(served.authenticateMerchant("bad"), logged), {
        _tag: "InvalidIdTokenError",
      });
    }),
  );
});
