import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import Backend from "#backend/worker.ts";
import { deployedSecrets, stageProviders, stageState } from "#devkit/cloudflare/deployed-stack.ts";
import { workerNameOf } from "#devkit/cloudflare/stage.ts";

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

export default Alchemy.Stack(
  "testbed",
  { providers: stageProviders, state: stageState, secrets: deployedSecrets },
  Effect.gen(function* () {
    const website = yield* Website;
    yield* Backend;
    return { websiteUrl: website.url.as<string>() };
  }),
);
