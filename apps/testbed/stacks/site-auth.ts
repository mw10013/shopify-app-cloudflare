/**
 * The site auth wiring every testbed stack shares, the deployed one and the integ harnesses: the
 * Backend's auth origin and code delivery, the stage's seeded users and its control door.
 *
 * @module
 */

import { type Environment, environmentOf } from "@mw10013/rigging/cloudflare/stage";
import {
  type BindableWorker,
  bindSiteAuth,
  seedSiteUsers,
  type SignInCodeDeliveryMode,
  type SiteUserSeed,
} from "@mw10013/shopify-app-cloudflare/stack";
import * as Alchemy from "alchemy";
import type * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";

import { Database } from "#backend/resources.ts";

/** The admin the `dev`, `test` and `e2e` stages seed; codes for it are shown inline. */
export const TEST_ADMIN = "admin@testbed.test";

/** A signed-up `user` the `test` stage seeds, whom the admin gate refuses. */
export const TEST_USER = "user@testbed.test";

/** The admin a deployed stage seeds: a real inbox, since those stages mail codes. */
const DEPLOYED_ADMIN = "support@mw10013.com";

const siteUsersFor = Match.type<Environment>().pipe(
  Match.whenOr("dev", "e2e", (): readonly SiteUserSeed[] => [{ email: TEST_ADMIN, role: "admin" }]),
  Match.when("test", (): readonly SiteUserSeed[] => [
    { email: TEST_ADMIN, role: "admin" },
    { email: TEST_USER, role: "user" },
  ]),
  Match.whenOr("staging", "production", (): readonly SiteUserSeed[] => [
    { email: DEPLOYED_ADMIN, role: "admin" },
  ]),
  Match.exhaustive,
);

/** Codes are shown inline on the disposable stages and mailed on the deployed ones. */
const deliveryFor = Match.type<Environment>().pipe(
  Match.whenOr("dev", "test", "e2e", (): SignInCodeDeliveryMode => "inline"),
  Match.whenOr("staging", "production", (): SignInCodeDeliveryMode => "mailed"),
  Match.exhaustive,
);

/**
 * Binds site auth onto `backend` for the Website at `websiteUrl`, seeds the stage's users, and
 * opens the control door: to anyone on `dev`, `test` and `e2e`, to a bearer of `CONTROL_TOKEN` on
 * staging, and not at all on production.
 */
export const wireSiteAuth = Effect.fn("Stack.wireSiteAuth")(function* (
  backend: BindableWorker,
  websiteUrl: Output.Output<string | undefined>,
) {
  const environment = yield* environmentOf(yield* Alchemy.Stage);
  yield* bindSiteAuth(backend, { authOrigin: websiteUrl, delivery: deliveryFor(environment) });
  yield* seedSiteUsers(yield* Database, siteUsersFor(environment));
  yield* Match.value(environment).pipe(
    Match.whenOr("dev", "test", "e2e", () =>
      backend.bind("Control", { env: { CONTROL_ACCESS: "open" } }),
    ),
    Match.when("staging", () =>
      Effect.flatMap(Config.Redacted("CONTROL_TOKEN"), (token) =>
        backend.bind("Control", { env: { CONTROL_ACCESS: "token", CONTROL_TOKEN: token } }),
      ),
    ),
    Match.when("production", () => Effect.void),
    Match.exhaustive,
  );
});
