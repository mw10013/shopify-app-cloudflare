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
  type ShopifyAppBinding,
  shopifyCliApp,
} from "@mw10013/shopify-app-workers/stack";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { backendWorkerFor } from "#e2e/backend-worker.ts";
import {
  E2E_SESSION_BINDING,
  E2E_SESSION_FILE,
  e2eSessionEnv,
  E2eSessionJson,
} from "#e2e/session.ts";

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
 * `berth.json` gives it, and the fake app otherwise (a bare `alchemy destroy`); a deployed stage
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

/**
 * The e2e session `vp run e2e:start` wrote, on `e2e` only, and none on every other stage or when
 * the file is absent (a bare `alchemy destroy`), when the status route answers every request 401.
 */
const e2eSessionFor = Effect.gen(function* () {
  if ((yield* environmentOf(yield* Alchemy.Stage)) !== "e2e") return Option.none();
  const fs = yield* FileSystem.FileSystem;
  const file = new URL(E2E_SESSION_FILE, import.meta.url);
  if (!(yield* fs.exists(file.pathname))) return Option.none();
  return Option.some(
    yield* Schema.decodeEffect(E2eSessionJson)(yield* fs.readFileString(file.pathname)),
  );
});

export default Alchemy.Stack(
  "testbed",
  { providers: stageProviders, state: stageState, secrets: deployedSecrets },
  Effect.gen(function* () {
    const website = yield* Website;
    const BackendWorker = yield* backendWorker;
    const backend = yield* BackendWorker;
    yield* bindShopifyApp(backend, {
      app: yield* shopifyAppFor(website.url),
      partner: yield* partnerFor,
    });
    const session = yield* e2eSessionFor;
    if (Option.isSome(session))
      yield* backend.bind(E2E_SESSION_BINDING, { env: e2eSessionEnv(session.value) });
    return { websiteUrl: website.url.as<string>() };
  }).pipe(Effect.orDie),
);
