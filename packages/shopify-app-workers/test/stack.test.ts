import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  type BindableWorker,
  bindShopifyApp,
  fakeShopifyApp,
  partnerBindingFromConfig,
  readAppHandle,
  shopifyCliApp,
} from "@mw10013/shopify-app-workers/stack";
import {
  FAKE_APP_HANDLE,
  FAKE_SHOPIFY_API_KEY,
  FAKE_SHOPIFY_API_SECRET,
} from "@mw10013/shopify-app-workers/test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { appHandleConfig, partnerConfig, shopifyCredentialsConfig } from "#internal/bindings.ts";

import { reachedPackages } from "./reach.ts";

/** A Backend that records what is bound to it. */
const recordingWorker = () => {
  const bound: { readonly id: string; readonly env: Readonly<Record<string, unknown>> }[] = [];
  const worker: BindableWorker = {
    bind: (id, { env }) =>
      Effect.sync(() => {
        bound.push({ id, env });
      }),
  };
  return { bound, worker };
};

const withEnv = (env: Record<string, string>) =>
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(env));

const PARTNER_ENV = {
  SHOPIFY_PARTNER_ORG_ID: "123",
  SHOPIFY_PARTNER_APP_ID: "456",
  SHOPIFY_PARTNER_API_TOKEN: "prtapi_x",
};

describe("/stack", () => {
  it("reaches neither @shopify/shopify-api nor node:sqlite, so stack code stays light", () => {
    const reached = reachedPackages("stack.ts");
    assert.deepStrictEqual(
      reached.filter(
        (specifier) => specifier.startsWith("@shopify/shopify-api") || specifier === "node:sqlite",
      ),
      [],
    );
  });

  it.effect("shopifyCliApp is Some only when the CLI injected all three variables", () =>
    Effect.gen(function* () {
      const full = { APP_URL: "https://x.trycloudflare.com", SHOPIFY_API_KEY: "k" };
      assert.isTrue(Option.isNone(yield* shopifyCliApp("cli-app").pipe(withEnv(full))));
      const app = yield* shopifyCliApp("cli-app").pipe(
        withEnv({ ...full, SHOPIFY_API_SECRET: "s" }),
      );
      assert.isTrue(Option.isSome(app));
      if (Option.isSome(app)) {
        assert.strictEqual(app.value.handle, "cli-app");
        assert.strictEqual(app.value.appUrl, full.APP_URL);
        assert.strictEqual(Redacted.value(app.value.apiSecret), "s");
      }
    }),
  );

  it("readAppHandle reads the toml's top-level handle, and throws without one", () => {
    const toml = (contents: string) => {
      const file = path.join(mkdtempSync(path.join(tmpdir(), "swa-handle-")), "shopify.app.toml");
      writeFileSync(file, contents);
      return file;
    };
    assert.strictEqual(
      readAppHandle(toml('# a comment\nname = "App"\nhandle = "my-app-dev" # pinned\n[auth]\n')),
      "my-app-dev",
    );
    assert.throws(() => readAppHandle(toml('[app]\nhandle = "nested"\n')), /no top-level handle/u);
    assert.throws(() => readAppHandle(toml('handle = "Not A Handle"\n')));
  });

  it.effect("partnerBindingFromConfig reads and decodes the three Partner credentials", () =>
    Effect.gen(function* () {
      const partner = yield* partnerBindingFromConfig.pipe(withEnv(PARTNER_ENV));
      assert.strictEqual(partner.SHOPIFY_PARTNER_ORG_ID, "123");
      assert.strictEqual(Redacted.value(partner.SHOPIFY_PARTNER_API_TOKEN), "prtapi_x");
      const bad = yield* Effect.exit(
        partnerBindingFromConfig.pipe(withEnv({ ...PARTNER_ENV, SHOPIFY_PARTNER_ORG_ID: "x" })),
      );
      assert.strictEqual(bad._tag, "Failure");
    }),
  );

  it.effect(
    "bindShopifyApp binds the app under the names ShopifyClient reads, and Partner only when given",
    () =>
      Effect.gen(function* () {
        const { bound, worker } = recordingWorker();
        yield* bindShopifyApp(worker, {
          app: fakeShopifyApp("http://localhost:1234"),
          partner: Option.none(),
        });
        assert.deepStrictEqual(
          bound.map(({ id }) => id),
          ["Shopify"],
        );
        const env = bound[0]?.env ?? {};
        assert.strictEqual(env.SHOPIFY_APP_HANDLE, FAKE_APP_HANDLE);
        assert.strictEqual(env.SHOPIFY_API_KEY, FAKE_SHOPIFY_API_KEY);
        assert.strictEqual(
          Redacted.value(env.SHOPIFY_API_SECRET as Redacted.Redacted),
          FAKE_SHOPIFY_API_SECRET,
        );
        assert.strictEqual(env.SHOPIFY_APP_URL, "http://localhost:1234");

        const partner = yield* partnerBindingFromConfig.pipe(withEnv(PARTNER_ENV));
        const second = recordingWorker();
        yield* bindShopifyApp(second.worker, {
          app: fakeShopifyApp("http://localhost:1234"),
          partner: Option.some(partner),
        });
        assert.deepStrictEqual(
          second.bound.map(({ id }) => id),
          ["Shopify", "ShopifyPartner"],
        );
        assert.deepStrictEqual(Object.keys(second.bound[1]?.env ?? {}).toSorted(), [
          "SHOPIFY_PARTNER_API_TOKEN",
          "SHOPIFY_PARTNER_APP_ID",
          "SHOPIFY_PARTNER_ORG_ID",
        ]);
      }),
  );

  it.effect("what bindShopifyApp binds is what the Backend's layerConfigs read", () =>
    Effect.gen(function* () {
      const { bound, worker } = recordingWorker();
      yield* bindShopifyApp(worker, {
        app: fakeShopifyApp("http://localhost:1234"),
        partner: Option.some(yield* partnerBindingFromConfig.pipe(withEnv(PARTNER_ENV))),
      });
      // A Worker's binding as a string, the way the runtime hands a secret to `Config`.
      const env: Record<string, string> = Object.fromEntries(
        bound
          .flatMap(({ env: each }) => Object.entries(each))
          .map(([name, value]): [string, string] => [
            name,
            Redacted.isRedacted(value) ? String(Redacted.value(value)) : String(value),
          ]),
      );
      const credentials = yield* shopifyCredentialsConfig.pipe(withEnv(env));
      assert.strictEqual(Option.getOrThrow(credentials.apiKey), FAKE_SHOPIFY_API_KEY);
      assert.strictEqual(Option.getOrThrow(credentials.appUrl), "http://localhost:1234");
      assert.strictEqual(yield* appHandleConfig.pipe(withEnv(env)), FAKE_APP_HANDLE);
      assert.strictEqual(
        (yield* partnerConfig.pipe(withEnv(env))).SHOPIFY_PARTNER_ORG_ID,
        PARTNER_ENV.SHOPIFY_PARTNER_ORG_ID,
      );
    }),
  );
});
