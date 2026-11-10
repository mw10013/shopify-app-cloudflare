import { type Environment, environmentOf } from "@mw10013/rigging/cloudflare/stage";
import {
  type BindableWorker,
  bindSiteAuth,
  seedSiteUsers,
  type SiteUserSeed,
} from "@mw10013/shopify-app-cloudflare/stack";
import * as Alchemy from "alchemy";
import type * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";

import { Database } from "#backend/resources.ts";

export const TEST_ADMIN = "admin@testbed.test";

export const TEST_USER = "user@testbed.test";

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

export const wireSiteAuth = Effect.fn("Stack.wireSiteAuth")(function* (
  backend: BindableWorker,
  websiteUrl: Output.Output<string | undefined>,
) {
  const environment = yield* environmentOf(yield* Alchemy.Stage);
  yield* bindSiteAuth(backend, { authOrigin: websiteUrl, environment });
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
