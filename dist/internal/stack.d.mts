import { PartnerConfig } from "./bindings.mjs";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import * as Redacted from "effect/Redacted";
import * as Output from "alchemy/Output";
/** The Shopify app a stage's Backend serves, as the stack binds it. */
export interface ShopifyAppBinding {
  /** The app's URL handle, which its plan selection page names. Public, not a credential. */
  readonly handle: string;
  readonly apiKey: string;
  readonly apiSecret: Redacted.Redacted;
  /** The app's public URL: Shopify CLI's tunnel under `shopify app dev`, else the Website's own. */
  readonly appUrl: string | Output.Output<string | undefined>;
}
/** An app's public identity, as its stage's `shopify.app*.toml` writes it. */
export interface AppIdentity {
  /** The top-level `handle`. */
  readonly handle: string;
  /** The top-level `client_id`, which Shopify calls the app's API key. */
  readonly apiKey: string;
}
/**
 * The public identity of the app the toml at `tomlPath` configures: its top-level `handle` and
 * `client_id`, read from the lines before the first table header. A stage's toml is the one place
 * its app's identity is written, so the stack reads it rather than its environment. Throws,
 * naming the path, when the file is missing or either key is absent or malformed.
 */
export declare const readAppIdentity: (tomlPath: string | URL) => AppIdentity;
/**
 * Shopify CLI's app, `Some` only when `APP_URL`, `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are
 * all present. The CLI injects them into the web command it runs, so they exist only under
 * `shopify app dev`, which runs `alchemy dev` as that command; the process environment wins over
 * `.env`, so `.env` cannot shadow them. The identity is the toml's at `tomlPath`, the one the
 * CLI serves; the injected key must equal its `client_id`, else the CLI serves another app and
 * this fails, naming both.
 */
export declare const shopifyCliApp: (tomlPath: string | URL) => Config.Config<Option.Option<ShopifyAppBinding>>;
/**
 * A deployed stage's app: its identity from the stage's toml at `tomlPath`, and only its secret,
 * `SHOPIFY_API_SECRET`, from the deploy's environment, served at `appUrl` (the Website's own
 * URL). A missing toml or secret fails the plan rather than falling back to the fake app.
 */
export declare const deployedShopifyApp: (tomlPath: string | URL, appUrl: ShopifyAppBinding["appUrl"]) => Config.Config<ShopifyAppBinding>;
/**
 * The fake app served at `appUrl`: `/test`'s constants, which only a token or a webhook a test
 * signs verifies against. For a stage with no real app (a test stage, or a bare `alchemy
 * destroy` outside `shopify app dev`).
 */
export declare const fakeShopifyApp: (appUrl: ShopifyAppBinding["appUrl"]) => ShopifyAppBinding;
/** The Partner values a stage binds, read from `.env` or a deploy's environment. */
export declare const partnerBindingFromConfig: Config.Config<PartnerConfig>;
/** What {@link bindShopifyApp} needs of the Backend: Alchemy's `Worker.bind`. */
export interface BindableWorker {
  readonly bind: (id: string, binding: {
    readonly env: Readonly<Record<string, unknown>>;
  }) => Effect.Effect<void>;
}
/**
 * Binds the Backend's Shopify configuration: the app as `SHOPIFY_APP_HANDLE`, `SHOPIFY_API_KEY`,
 * `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL`, and, when `partner` is `Some`, the Partner
 * credentials. With `None` none is bound, and the Backend's billing dies on its first Partner
 * call while webhooks, the grantor and a shop with a cached plan work (`PartnerApi.layerUnbound`).
 */
export declare const bindShopifyApp: (backend: BindableWorker, options: {
  readonly app: ShopifyAppBinding;
  readonly partner: Option.Option<PartnerConfig>;
}) => Effect.Effect<void, never, never>;