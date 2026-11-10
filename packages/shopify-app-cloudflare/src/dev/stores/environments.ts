import * as Schema from "effect/Schema";

import { WebEnvironment } from "#dev/web.ts";

import { DeployedStage } from "./names.ts";

/** The environments that lease a pool store: a checkout's dev and e2e servers. */
export const LeasedEnvironment = WebEnvironment;
export type LeasedEnvironment = typeof LeasedEnvironment.Type;

/** Every environment that has a store; `test` has none. */
export const Environment = Schema.Literals([
  ...LeasedEnvironment.literals,
  ...DeployedStage.literals,
]);
export type Environment = typeof Environment.Type;

/**
 * The app config each environment runs with, fixed by convention: `shopify.app.toml` for `dev` and
 * `shopify.app.<environment>.toml` for the rest. Its `handle` names the app in admin URLs.
 */
export const tomlOf = (environment: Environment): string =>
  environment === "dev" ? "shopify.app.toml" : `shopify.app.${environment}.toml`;
