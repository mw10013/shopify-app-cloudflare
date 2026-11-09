import * as Cloudflare from "@alchemy.run/cloudflare";
import { stageProviders, stageState } from "@mw10013/rigging/cloudflare/deployed-stack";
import { bindShopifyApp, fakeShopifyApp } from "@mw10013/shopify-app-workers/stack";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { backendProps } from "#backend/backend.ts";

import TestBackend from "./backend.ts";

/**
 * {@link TestBackend} and a test Website bound to it as `BACKEND`, for the test harness. The
 * Backend serves the fake app at the Website's URL with no Partner values: tier 2 runs over the
 * door's Partner fake instead. The real Website is left out: under dev it would start the
 * TanStack Start dev server and want `WEBSITE_PORT`.
 */
export default Alchemy.Stack(
  "testbed-test",
  { providers: stageProviders, state: stageState },
  Effect.gen(function* () {
    const backend = yield* TestBackend;
    const website = yield* Cloudflare.Worker("TestWebsite", {
      main: `${import.meta.dirname}/website.ts`,
      compatibility: backendProps.compatibility,
      env: { BACKEND: backend },
    });
    yield* bindShopifyApp(backend, { app: fakeShopifyApp(website.url), partner: Option.none() });
    return {
      backendUrl: backend.url.as<string>(),
      websiteUrl: website.url.as<string>(),
    };
  }),
);
