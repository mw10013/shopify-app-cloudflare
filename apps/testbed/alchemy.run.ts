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

/** The Backend Worker this stage deploys ({@link backendWorkerFor}). */
const backendWorker = Effect.map(Effect.flatMap(Alchemy.Stage, environmentOf), backendWorkerFor);

/**
 * The TanStack Start app. `alchemy dev` serves it on `WEBSITE_PORT`, which `dev:alchemy` sets to
 * the port Shopify CLI picked for its web command; deploys never read it. `strictPort` makes a
 * collision fail instead of silently moving ports.
 *
 * `SHOPIFY_API_KEY` goes into the App Home's page, so it is public: the stage's app's, the same key
 * the Backend binds ({@link shopifyAppFor}). `SHOPIFY_APP_URL` is the URL the Shopify admin loads
 * the app at, which the ID token bounce reloads: Shopify CLI's tunnel under `shopify app dev`,
 * the Website's own URL otherwise.
 */
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

/** A stage's `shopify.app*.toml`, the one place its app's public identity is written. */
const toml = (file: string) => new URL(file, import.meta.url);

/**
 * The Shopify app this stage's Backend serves, served at `appUrl` unless the CLI's tunnel is.
 * Each environment's toml holds its app's handle and client ID; only the secret comes from the
 * environment. `dev` and `e2e` serve Shopify CLI's app under `shopify app dev`, from the toml
 * `tomlOf` (`/dev/stores`) names, and the fake app otherwise (a bare `alchemy destroy`); a deployed stage
 * reads its toml and its deploy's `SHOPIFY_API_SECRET`, so a missing one fails the plan; `test`
 * always serves the fake app.
 */
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
    yield* requireStageEnv(StageEnv);
    const website = yield* Website;
    const BackendWorker = yield* backendWorker;
    const backend = yield* BackendWorker;
    yield* bindShopifyApp(backend, {
      app: yield* shopifyAppFor(website.url),
      partner: yield* partnerFor,
    });
    yield* wireSiteAuth(backend, website.url);
    // The session `vp run e2e:start` wrote, which gates the e2e routes only `e2e` serves.
    if ((yield* environmentOf(yield* Alchemy.Stage)) === "e2e")
      yield* bindE2eSession(backend, new URL(".", import.meta.url));
    return { websiteUrl: website.url.as<string>() };
  }).pipe(Effect.orDie),
);
