/**
 * Stack-time helpers: what an app's `alchemy.run.ts` binds to its Backend so the package's
 * `layerConfig`s find it. Evaluated by `alchemy dev` and `alchemy deploy`; the Backend bundle
 * never imports it. Which app a stage serves is the app's choice, a `Match` on its environment,
 * so these helpers only read and bind.
 *
 * @module
 */

import type * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { FAKE_SHOPIFY_API_KEY, FAKE_SHOPIFY_API_SECRET } from "#test/fake-app.ts";

import {
  type PartnerConfig,
  partnerConfig,
  SHOPIFY_BINDING,
  SHOPIFY_PARTNER_BINDING,
} from "./bindings.ts";

/** The Shopify app a stage's Backend serves, as the stack binds it. */
export interface ShopifyAppBinding {
  readonly apiKey: string;
  readonly apiSecret: Redacted.Redacted;
  /** The app's public URL: Shopify CLI's tunnel under `shopify app dev`, else the Website's own. */
  readonly appUrl: string | Output.Output<string | undefined>;
}

/**
 * Shopify CLI's app, `Some` only when `APP_URL`, `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are
 * all present. The CLI injects them into the web command it runs, so they exist only under
 * `shopify app dev`, which runs `alchemy dev` as that command; the process environment wins over
 * `.env`, so `.env` cannot shadow them.
 */
export const shopifyCliApp: Config.Config<Option.Option<ShopifyAppBinding>> = Config.all({
  appUrl: Config.option(Config.String("APP_URL")),
  apiKey: Config.option(Config.String("SHOPIFY_API_KEY")),
  apiSecret: Config.option(Config.Redacted("SHOPIFY_API_SECRET")),
}).pipe(Config.map(Option.all));

/**
 * A deployed stage's app, from its deploy's environment, served at `appUrl` (the Website's own
 * URL). A missing value fails the plan rather than falling back to the fake app.
 */
export const deployedShopifyApp = (
  appUrl: ShopifyAppBinding["appUrl"],
): Config.Config<ShopifyAppBinding> =>
  Config.all({
    apiKey: Config.String("SHOPIFY_API_KEY"),
    apiSecret: Config.Redacted("SHOPIFY_API_SECRET"),
  }).pipe(Config.map((app) => ({ ...app, appUrl })));

/**
 * The fake app served at `appUrl`: `/test`'s constants, which only a token or a webhook a test
 * signs verifies against. For a stage with no real app (a test stage, or a bare `alchemy
 * destroy` outside `shopify app dev`).
 */
export const fakeShopifyApp = (appUrl: ShopifyAppBinding["appUrl"]): ShopifyAppBinding => ({
  apiKey: FAKE_SHOPIFY_API_KEY,
  apiSecret: Redacted.make(FAKE_SHOPIFY_API_SECRET),
  appUrl,
});

/** The Partner values a stage binds, read from `.env` or a deploy's environment. */
export const partnerBindingFromConfig: Config.Config<PartnerConfig> = partnerConfig;

/** What {@link bindShopifyApp} needs of the Backend: Alchemy's `Worker.bind`. */
export interface BindableWorker {
  readonly bind: (
    id: string,
    binding: { readonly env: Readonly<Record<string, unknown>> },
  ) => Effect.Effect<void>;
}

/**
 * Binds the Backend's Shopify configuration: the app as `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`
 * and `SHOPIFY_APP_URL`, and, when `partner` is `Some`, the Partner values. With `None` nothing
 * is bound, and the Backend's billing dies on its first Partner call while webhooks and the
 * grantor work (`PartnerApi.layerUnbound`).
 */
export const bindShopifyApp = Effect.fn("Stack.bindShopifyApp")(function* (
  backend: BindableWorker,
  options: {
    readonly app: ShopifyAppBinding;
    readonly partner: Option.Option<PartnerConfig>;
  },
) {
  yield* backend.bind(SHOPIFY_BINDING, {
    env: {
      SHOPIFY_API_KEY: options.app.apiKey,
      SHOPIFY_API_SECRET: options.app.apiSecret,
      SHOPIFY_APP_URL: options.app.appUrl,
    },
  });
  if (Option.isSome(options.partner))
    yield* backend.bind(SHOPIFY_PARTNER_BINDING, { env: options.partner.value });
});
