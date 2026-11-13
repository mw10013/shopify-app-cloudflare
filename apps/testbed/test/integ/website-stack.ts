import * as Cloudflare from "@alchemy.run/cloudflare";
import { stageProviders, stageState } from "@mw10013/rigging/cloudflare/deployed-stack";
import { bindShopifyApp, fakeShopifyApp } from "@mw10013/shopify-app-cloudflare/stack";
import { FAKE_SHOPIFY_API_KEY } from "@mw10013/shopify-app-cloudflare/test";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { backendProps } from "#backend/backend.ts";
import { wireSiteAuth } from "#root/stacks/site-auth.ts";

import TestBackend from "./backend.ts";

export default Alchemy.Stack(
  "testbed-website-test",
  { providers: stageProviders, state: stageState },
  Effect.gen(function* () {
    const backend = yield* TestBackend;
    const website = yield* Cloudflare.Worker("BuiltWebsite", {
      main: `${import.meta.dirname}/../../dist/server/server.js`,
      compatibility: backendProps.compatibility,
      env: {
        BACKEND: backend,
        SHOPIFY_API_KEY: FAKE_SHOPIFY_API_KEY,
        SHOPIFY_APP_URL: Cloudflare.Worker.URL,
      },
    });
    yield* bindShopifyApp(backend, { app: fakeShopifyApp(website.url), partner: Option.none() });
    yield* wireSiteAuth(backend, website.url);
    return {
      backendUrl: backend.url.as<string>(),
      websiteUrl: website.url.as<string>(),
    };
  }),
);
