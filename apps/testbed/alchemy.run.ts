import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  deployedSecrets,
  stageProviders,
  stageState,
} from "@mw10013/devkit/cloudflare/deployed-stack";
import { environmentOf, workerNameOf } from "@mw10013/devkit/cloudflare/stage";
import {
  bindShopifyApp,
  deployedShopifyApp,
  fakeShopifyApp,
  partnerBindingFromConfig,
  readAppHandle,
  type ShopifyAppBinding,
  shopifyCliApp,
} from "@mw10013/shopify-app-workers/stack";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import Backend from "#backend/worker.ts";

/**
 * The TanStack Start app. `alchemy dev` serves it on `WEBSITE_PORT`, which `dev:alchemy` sets to
 * the port Shopify CLI picked for its web command; deploys never read it. `strictPort` makes a
 * collision fail instead of silently moving ports.
 *
 * `SHOPIFY_API_KEY` goes into the App Home's page, so it is public. Shopify CLI injects it under
 * `shopify app dev`; a bare `alchemy destroy` of the stage runs without it and binds it empty.
 */
export class Website extends Cloudflare.Website.Vite<Website>()(
  "Website",
  Effect.gen(function* () {
    const dev = (yield* Alchemy.ALCHEMY_DEV)
      ? { port: yield* Config.Port("WEBSITE_PORT"), strictPort: true }
      : undefined;
    return {
      name: workerNameOf("testbed", yield* Alchemy.Stage, "website"),
      compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
      dev,
      env: {
        BACKEND: Backend,
        SHOPIFY_API_KEY: yield* Config.String("SHOPIFY_API_KEY").pipe(Config.withDefault("")),
      },
    };
  }).pipe(Effect.orDie),
) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

/** The handle of the app Shopify CLI serves from `shopify.app.toml`, read from the toml itself. */
const CLI_APP_HANDLE = readAppHandle(new URL("shopify.app.toml", import.meta.url));

/**
 * The Shopify app this stage's Backend serves, served at `appUrl` unless the CLI's tunnel is.
 * `dev` and `e2e` serve Shopify CLI's app under `shopify app dev` and the fake app otherwise (a
 * bare `alchemy destroy`); a deployed stage reads its app from the deploy's environment, so a
 * missing value fails the plan; `test` always serves the fake app.
 */
const shopifyAppFor = (appUrl: ShopifyAppBinding["appUrl"]) =>
  Effect.gen(function* () {
    const environment = yield* environmentOf(yield* Alchemy.Stage);
    return yield* Match.value(environment).pipe(
      Match.whenOr("dev", "e2e", () =>
        Effect.map(
          shopifyCliApp(CLI_APP_HANDLE),
          Option.getOrElse(() => fakeShopifyApp(appUrl)),
        ),
      ),
      Match.whenOr("staging", "production", () => deployedShopifyApp(appUrl)),
      Match.when("test", () => Effect.succeed(fakeShopifyApp(appUrl))),
      Match.exhaustive,
    );
  });

/**
 * The Partner credentials this stage binds: from `.env` on `dev` and `e2e`, and none while the
 * owner has not added them, when the Backend's billing dies on its first Partner call and
 * webhooks, the grantor and a shop with a cached plan still work; required on a deployed stage;
 * none on `test`, whose Backend uses the fake.
 */
const partnerFor = Effect.gen(function* () {
  const environment = yield* environmentOf(yield* Alchemy.Stage);
  return yield* Match.value(environment).pipe(
    Match.whenOr("dev", "e2e", () => Config.option(partnerBindingFromConfig)),
    Match.whenOr("staging", "production", () => Effect.map(partnerBindingFromConfig, Option.some)),
    Match.when("test", () => Effect.succeedNone),
    Match.exhaustive,
  );
});

export default Alchemy.Stack(
  "testbed",
  { providers: stageProviders, state: stageState, secrets: deployedSecrets },
  Effect.gen(function* () {
    const website = yield* Website;
    const backend = yield* Backend;
    yield* bindShopifyApp(backend, {
      app: yield* shopifyAppFor(website.url),
      partner: yield* partnerFor,
    });
    return { websiteUrl: website.url.as<string>() };
  }).pipe(Effect.orDie),
);
