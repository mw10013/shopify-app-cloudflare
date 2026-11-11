import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { AppTokens } from "#internal/app-tokens.ts";
import { FAKE_APP_TOKEN_KEY, FAKE_APP_TOKEN_KID, FAKE_SHOPIFY_API_KEY } from "#test/fake-app.ts";

/** Builds `AppTokens.layerConfig` over `env` as a Worker built by Alchemy would at startup. */
const startup = (env: Record<string, string>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      Object.assign(globalThis, { __ALCHEMY_RUNTIME__: true });
    }),
    () =>
      Effect.exit(
        Effect.scoped(Layer.build(AppTokens.layerConfig)).pipe(
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
        ),
      ),
    () =>
      Effect.sync(() => {
        Reflect.deleteProperty(globalThis, "__ALCHEMY_RUNTIME__");
      }),
  );

const failureText = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "";

const BOUND = {
  SHOPIFY_API_KEY: FAKE_SHOPIFY_API_KEY,
  SHOPIFY_APP_TOKEN_KEY: FAKE_APP_TOKEN_KEY,
  SHOPIFY_APP_TOKEN_KID: FAKE_APP_TOKEN_KID,
};

describe("AppTokens.layerConfig", () => {
  it.effect("N9. a bound, well-formed key starts", () =>
    Effect.gen(function* () {
      assert.isTrue(Exit.isSuccess(yield* startup(BOUND)));
    }),
  );

  it.effect("N9. a missing SHOPIFY_APP_TOKEN_KEY fails startup, naming the variable", () =>
    Effect.gen(function* () {
      const { SHOPIFY_APP_TOKEN_KEY: _key, ...unbound } = BOUND;
      const exit = yield* startup(unbound);
      assert.isTrue(Exit.isFailure(exit));
      assert.include(failureText(exit), "SHOPIFY_APP_TOKEN_KEY");
    }),
  );

  it.effect("N9. a malformed SHOPIFY_APP_TOKEN_KEY fails startup, naming the variable", () =>
    Effect.gen(function* () {
      for (const key of [
        "not a pem at all!",
        "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END PRIVATE KEY-----",
      ]) {
        const exit = yield* startup({ ...BOUND, SHOPIFY_APP_TOKEN_KEY: key });
        assert.isTrue(Exit.isFailure(exit), key);
        assert.include(failureText(exit), "SHOPIFY_APP_TOKEN_KEY");
      }
    }),
  );
});
