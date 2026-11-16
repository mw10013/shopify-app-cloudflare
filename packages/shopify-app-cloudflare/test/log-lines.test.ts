import * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { settleDestroy } from "#internal/shop-actors.ts";
import { BEHAVIOR_SHOP, seedAt } from "#test/auth-behaviors.ts";
import { BEHAVIOR_PROBE_TOPIC } from "#test/behavior-app.ts";
import { FAKE_APP_TOKEN_KID } from "#test/fake-app.ts";
import { inProcessHarness } from "#test/node/shopify-harness.ts";
import { ShopifyFake } from "#test/shopify-fake.ts";
import { ShopifyHarness } from "#test/shopify-harness.ts";

import { capturingLogs, type Logged } from "./logs.ts";

const linesAt = (level: string, prefix: string) =>
  Effect.map(
    Effect.flatMap(ShopifyHarness, (harness) => harness.logs),
    (lines) =>
      lines
        .filter((line) => line.level === level && line.message.startsWith(prefix))
        .map(({ message }) => message),
  );

describe("log lines", () => {
  it.live("AppTokens.mint writes each detail as key=value", () =>
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).revokeKey(FAKE_APP_TOKEN_KID);
      yield* Effect.exit((yield* ShopifyHarness).ensureSession(BEHAVIOR_SHOP));
      const lines = yield* linesAt("Error", "AppTokens.mint:");
      assert.strictEqual(lines.length, 1);
      assert.match(
        lines[0] ?? "",
        new RegExp(
          `^AppTokens\\.mint: shop=${BEHAVIOR_SHOP} status=refused httpStatus=401 requestId=\\S+ error=\\S+$`,
          "u",
        ),
      );
    }).pipe(Effect.provide(inProcessHarness())),
  );

  it.live("Webhooks.handle writes an answered failure's fields as key=value", () =>
    Effect.gen(function* () {
      yield* seedAt({
        accessTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.hours(1)),
      });
      yield* (yield* ShopifyFake).script([
        { route: "graphql", status: 402, body: { errors: "frozen" } },
      ]);
      const harness = yield* ShopifyHarness;
      yield* harness.deliver({ topic: BEHAVIOR_PROBE_TOPIC, shop: BEHAVIOR_SHOP, payload: {} });
      assert.deepStrictEqual(yield* linesAt("Warn", "Webhooks.handle:"), [
        `Webhooks.handle: shop=${BEHAVIOR_SHOP} topic=${BEHAVIOR_PROBE_TOPIC} error=ShopInaccessibleError status=402`,
      ]);
    }).pipe(Effect.provide(inProcessHarness())),
  );

  it.effect("ShopActors.destroy names the actor as key=value pairs", () =>
    Effect.gen(function* () {
      const logged: Logged[] = [];
      const call = Effect.fail(
        new Cloudflare.RpcCallError({ method: "destroy", cause: new Error("down") }),
      ) as unknown as Effect.Effect<void>;
      yield* Effect.exit(
        settleDestroy({ shop: "a.myshopify.com", name: "actor" }, call).pipe(capturingLogs(logged)),
      );
      assert.deepStrictEqual(logged, [
        {
          level: "Error",
          message: "ShopActors.destroy: shop=a.myshopify.com name=actor status=failed",
        },
      ]);
    }),
  );
});
