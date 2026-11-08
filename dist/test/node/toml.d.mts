import { ShopifyAppDefinition } from "../../internal/shopify-app.mjs";
/**
 * Asserts, with `node:assert`, that the toml at `tomlPath` matches `app`:
 *
 * - `[webhooks] api_version` is the package's `ADMIN_API_VERSION`;
 * - every subscription's `uri` is under `/webhooks/`, the only path the Backend answers,
 *   relative or on an absolute origin;
 * - the subscribed topics are exactly the built-in topics and `app`'s extra ones, so a
 *   subscription nobody handles, or a handler nobody subscribed, fails here and not in
 *   production.
 */
export declare const expectTomlMatches: (options: {
  readonly tomlPath: string | URL;
  readonly app: ShopifyAppDefinition<unknown, unknown>;
}) => void;