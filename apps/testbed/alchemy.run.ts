import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  deployedSecrets,
  requireStageEnv,
  stageProviders,
  stageState,
} from "@mw10013/rigging/cloudflare/deployed-stack";
import { environmentOf, workerNameOf } from "@mw10013/rigging/cloudflare/stage";
import {
  bindE2eSession,
  bindShopifyApp,
  deployedShopifyApp,
  fakeShopifyApp,
  partnerBindingFromConfig,
  type ShopifyAppBinding,
  shopifyCliApp,
} from "@mw10013/shopify-app-cloudflare/stack";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import { backendWorkerFor } from "#e2e/backend-worker.ts";

import { wireSiteAuth } from "./stacks/site-auth.ts";
import StageEnv from "./stacks/stage-env.ts";

const backendWorker = Effect.map(Effect.flatMap(Alchemy.Stage, environmentOf), backendWorkerFor);

export class Website extends Cloudflare.Website.Vite<Website>()(
  "Website",
  Effect.gen(function* () {
    const dev = (yield* Alchemy.ALCHEMY_DEV)
      ? { port: yield* Config.Port("WEBSITE_PORT"), strictPort: true }
      : undefined;
    const app = yield* shopifyAppFor("");
    return {
      name: workerNameOf("testbed", yield* Alchemy.Stage, "website"),
      compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
      dev,
      env: {
        BACKEND: yield* backendWorker,
        SHOPIFY_API_KEY: app.apiKey,
        SHOPIFY_APP_URL:
          typeof app.appUrl === "string" && app.appUrl !== "" ? app.appUrl : Cloudflare.Worker.URL,
      },
    };
  }).pipe(Effect.orDie),
) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

const toml = (file: string) => new URL(file, import.meta.url);

const shopifyAppFor = (appUrl: ShopifyAppBinding["appUrl"]) =>
  Effect.gen(function* () {
    const environment = yield* environmentOf(yield* Alchemy.Stage);
    const cliApp = (file: string) =>
      Effect.map(
        shopifyCliApp(toml(file)),
        Option.getOrElse(() => fakeShopifyApp(appUrl)),
      );
    return yield* Match.value(environment).pipe(
      Match.when("dev", () => cliApp("shopify.app.toml")),
      Match.when("e2e", () => cliApp("shopify.app.e2e.toml")),
      Match.when("staging", () => deployedShopifyApp(toml("shopify.app.staging.toml"), appUrl)),
      Match.when("production", () =>
        deployedShopifyApp(toml("shopify.app.production.toml"), appUrl),
      ),
      Match.when("test", () => Effect.succeed(fakeShopifyApp(appUrl))),
      Match.exhaustive,
    );
  });

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
    yield* requireStageEnv(StageEnv);
    const website = yield* Website;
    const BackendWorker = yield* backendWorker;
    const backend = yield* BackendWorker;
    yield* bindShopifyApp(backend, {
      app: yield* shopifyAppFor(website.url),
      partner: yield* partnerFor,
    });
    yield* wireSiteAuth(backend, website.url);
    if ((yield* environmentOf(yield* Alchemy.Stage)) === "e2e")
      yield* bindE2eSession(backend, new URL(".", import.meta.url));
    return { websiteUrl: website.url.as<string>() };
  }).pipe(Effect.orDie),
);
