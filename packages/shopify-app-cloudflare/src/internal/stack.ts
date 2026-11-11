/**
 * Stack-time helpers: what an app's `alchemy.run.ts` binds to its Backend so the package's
 * `layerConfig`s find it. Evaluated by `alchemy dev` and `alchemy deploy`; the Backend bundle
 * never imports it. Which app a stage serves is the app's choice, a `Match` on its environment,
 * so these helpers only read and bind.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import type * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  E2E_SESSION_BINDING,
  E2E_SESSION_FILE,
  e2eSessionEnv,
  E2eSessionJson,
} from "#test/e2e-session.ts";
import {
  FAKE_APP_HANDLE,
  FAKE_APP_TOKEN_KEY,
  FAKE_APP_TOKEN_KID,
  FAKE_SHOPIFY_API_KEY,
  FAKE_SHOPIFY_API_SECRET,
} from "#test/fake-app.ts";

import {
  AppHandle,
  type PartnerConfig,
  partnerConfig,
  SHOP_ACTOR_OBJECTS_BINDING,
  SHOP_ACTOR_OBJECTS_ENV,
  SHOPIFY_BINDING,
  SHOPIFY_PARTNER_BINDING,
  type SignInCodeDailyCap,
  type SignInCodeDeliveryMode,
  SITE_AUTH_BINDING,
  SITE_AUTH_ENV,
} from "./bindings.ts";
import { Email, type Role } from "./site-auth-contract.ts";

/** The Shopify app a stage's Backend serves, as the stack binds it. */
export interface ShopifyAppBinding {
  /** The app's URL handle, which its plan selection page names. Public, not a credential. */
  readonly handle: string;
  readonly apiKey: string;
  readonly apiSecret: Redacted.Redacted;
  /** The app's public URL: Shopify CLI's tunnel under `shopify app dev`, else the Website's own. */
  readonly appUrl: string | Output.Output<string | undefined>;
  /** `SHOPIFY_APP_TOKEN_KEY`: the application-only grant's private key, PKCS #8 PEM, P-256. */
  readonly appTokenKey: Redacted.Redacted;
  /** `SHOPIFY_APP_TOKEN_KID`: the `kid` its public JWK is registered under. */
  readonly appTokenKid: string;
}

/**
 * The app's token signing key from the stage's environment (`.env` or a deploy's), never the
 * toml: the key is a secret, and the `kid` names it. Missing either fails the plan, naming it.
 */
const appTokenKeyConfig = Config.all({
  appTokenKey: Config.Redacted("SHOPIFY_APP_TOKEN_KEY"),
  appTokenKid: Config.String("SHOPIFY_APP_TOKEN_KID"),
});

const decodeAppHandle = Schema.decodeUnknownSync(AppHandle);

/** A Shopify app's client ID, the toml's `client_id`, which is its API key: 32 hex digits. */
const ClientId = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9a-f]{32}$/u));
const decodeClientId = Schema.decodeUnknownSync(ClientId);

const pathOf = (tomlPath: string | URL): string =>
  tomlPath instanceof URL ? fileURLToPath(tomlPath) : tomlPath;

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
export const readAppIdentity = (tomlPath: string | URL): AppIdentity => {
  const where = pathOf(tomlPath);
  let contents: string;
  try {
    contents = readFileSync(tomlPath, "utf8");
  } catch (cause) {
    throw new Error(`readAppIdentity: cannot read ${where}`, { cause });
  }
  const values = new Map<string, string>();
  for (const raw of contents.split("\n")) {
    const line = raw.replace(/#.*$/u, "").trim();
    if (line.startsWith("[")) break;
    const match = /^(?<key>handle|client_id)\s*=\s*"(?<value>[^"]*)"$/u.exec(line)?.groups;
    if (match?.key !== undefined && match.value !== undefined) values.set(match.key, match.value);
  }
  const value = (key: string) => {
    const found = values.get(key);
    if (found === undefined) throw new Error(`readAppIdentity: ${where} has no top-level ${key}`);
    return found;
  };
  return { handle: decodeAppHandle(value("handle")), apiKey: decodeClientId(value("client_id")) };
};

/** {@link readAppIdentity} as a `Config`, so a stage that never reaches it never reads the file. */
const appIdentityConfig = (tomlPath: string | URL): Config.Config<AppIdentity> =>
  Config.succeed(tomlPath).pipe(
    Config.mapEffect((path) =>
      Effect.try({
        try: () => readAppIdentity(path),
        catch: (cause) =>
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
          ),
      }),
    ),
  );

/**
 * Shopify CLI's app, `Some` only when `APP_URL`, `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are
 * all present. The CLI injects them into the web command it runs, so they exist only under
 * `shopify app dev`, which runs `alchemy dev` as that command; the process environment wins over
 * `.env`, so `.env` cannot shadow them. The identity is the toml's at `tomlPath`, the one the
 * CLI serves; the injected key must equal its `client_id`, else the CLI serves another app and
 * this fails, naming both. The token signing key, which the CLI does not inject, comes from
 * `.env`; without it this fails, naming it.
 */
export const shopifyCliApp = (
  tomlPath: string | URL,
): Config.Config<Option.Option<ShopifyAppBinding>> =>
  Config.all({
    appUrl: Config.option(Config.String("APP_URL")),
    apiKey: Config.option(Config.String("SHOPIFY_API_KEY")),
    apiSecret: Config.option(Config.Redacted("SHOPIFY_API_SECRET")),
  }).pipe(
    Config.map(Option.all),
    Config.mapEffect(
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (cli) =>
          Effect.flatMap(appIdentityConfig(tomlPath), (identity) =>
            cli.apiKey === identity.apiKey
              ? Effect.map(appTokenKeyConfig, (key) => Option.some({ ...cli, ...identity, ...key }))
              : Effect.fail(
                  new Config.ConfigError(
                    new ConfigProvider.SourceError({
                      message: `shopifyCliApp: Shopify CLI serves SHOPIFY_API_KEY ${cli.apiKey}, but ${pathOf(tomlPath)} has client_id ${identity.apiKey}`,
                    }),
                  ),
                ),
          ),
      }),
    ),
  );

/**
 * A deployed stage's app: its identity from the stage's toml at `tomlPath`, and its secrets,
 * `SHOPIFY_API_SECRET`, `SHOPIFY_APP_TOKEN_KEY` and `SHOPIFY_APP_TOKEN_KID`, from the deploy's
 * environment, served at `appUrl` (the Website's own URL). A missing toml or secret fails the
 * plan rather than falling back to the fake app.
 */
export const deployedShopifyApp = (
  tomlPath: string | URL,
  appUrl: ShopifyAppBinding["appUrl"],
): Config.Config<ShopifyAppBinding> =>
  Config.all({
    identity: appIdentityConfig(tomlPath),
    apiSecret: Config.Redacted("SHOPIFY_API_SECRET"),
    key: appTokenKeyConfig,
  }).pipe(
    Config.map(({ identity, apiSecret, key }) => ({ ...identity, apiSecret, ...key, appUrl })),
  );

/**
 * The fake app served at `appUrl`: `/test`'s constants, which only a token or a webhook a test
 * signs verifies against. For a stage with no real app (a test stage, or a bare `alchemy
 * destroy` outside `shopify app dev`).
 */
export const fakeShopifyApp = (appUrl: ShopifyAppBinding["appUrl"]): ShopifyAppBinding => ({
  handle: FAKE_APP_HANDLE,
  apiKey: FAKE_SHOPIFY_API_KEY,
  apiSecret: Redacted.make(FAKE_SHOPIFY_API_SECRET),
  appUrl,
  appTokenKey: Redacted.make(FAKE_APP_TOKEN_KEY),
  appTokenKid: FAKE_APP_TOKEN_KID,
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
 * Binds the Backend's Shopify configuration: the app as `SHOPIFY_APP_HANDLE`, `SHOPIFY_API_KEY`,
 * `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_APP_TOKEN_KEY` and `SHOPIFY_APP_TOKEN_KID`,
 * and, when `partner` is `Some`, the Partner credentials. With `None` none is bound, and the
 * Backend's billing dies on its first Partner call while webhooks, minting and a shop with a
 * cached plan work (`PartnerApi.layerUnbound`).
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
      SHOPIFY_APP_HANDLE: options.app.handle,
      SHOPIFY_API_KEY: options.app.apiKey,
      SHOPIFY_API_SECRET: options.app.apiSecret,
      SHOPIFY_APP_URL: options.app.appUrl,
      SHOPIFY_APP_TOKEN_KEY: options.app.appTokenKey,
      SHOPIFY_APP_TOKEN_KID: options.app.appTokenKid,
    },
  });
  if (Option.isSome(options.partner))
    yield* backend.bind(SHOPIFY_PARTNER_BINDING, { env: options.partner.value });
});

/**
 * Binds what `ShopActorObjects.layerConfig` reads to list the stage's `ShopActor` objects: the
 * Cloudflare account, and the `script` that hosts `ShopActor`, which its namespace is found by,
 * when `Some`. `apiToken`, a Workers Scripts Read token, is `Some` only on a stage that can list
 * (staging and production, from the deploy's trigger variables). With `None` the stage's `list`
 * and `orphans` die saying it cannot, while `destroyOrphan` still works.
 */
export const bindShopActorObjects = Effect.fn("Stack.bindShopActorObjects")(function* (
  backend: BindableWorker,
  options: {
    readonly accountId: string;
    readonly apiToken: Option.Option<Redacted.Redacted>;
    readonly script: Option.Option<string>;
  },
) {
  yield* backend.bind(SHOP_ACTOR_OBJECTS_BINDING, {
    env: {
      [SHOP_ACTOR_OBJECTS_ENV.accountId]: options.accountId,
      ...Option.match(options.apiToken, {
        onNone: () => ({}),
        onSome: (token) => ({ [SHOP_ACTOR_OBJECTS_ENV.apiToken]: token }),
      }),
      ...Option.match(options.script, {
        onNone: () => ({}),
        onSome: (script) => ({ [SHOP_ACTOR_OBJECTS_ENV.script]: script }),
      }),
    },
  });
});

const decodeE2eSession = Schema.decodeUnknownEffect(E2eSessionJson);

/**
 * Binds the e2e session the e2e server's `start` wrote under `appRoot` to the `e2e` stage's
 * Backend, which gates its e2e routes with it (`withE2eRoutes` in `/test/e2e/backend`). Binds
 * nothing when the file is absent (a bare `alchemy destroy`), and the routes then answer every
 * request 401. Only the `e2e` stage calls it: the app's stack picks the stage, as it picks the
 * Backend Worker that serves the routes.
 */
export const bindE2eSession = Effect.fn("Stack.bindE2eSession")(function* (
  backend: BindableWorker,
  appRoot: string | URL,
) {
  const file = path.join(pathOf(appRoot), E2E_SESSION_FILE);
  if (!existsSync(file)) return;
  const session = yield* decodeE2eSession(readFileSync(file, "utf8"));
  yield* backend.bind(E2E_SESSION_BINDING, { env: e2eSessionEnv(session) });
});

/** A stage's environment, as rigging's `environmentOf` names it. */
export type SiteAuthEnvironment = "dev" | "test" | "e2e" | "staging" | "production";

const siteAuthOf = (
  environment: SiteAuthEnvironment,
): { readonly delivery: SignInCodeDeliveryMode; readonly dailyCap: SignInCodeDailyCap } =>
  environment === "staging" || environment === "production"
    ? { delivery: "mailed", dailyCap: "on" }
    : { delivery: "inline", dailyCap: "off" };

/**
 * Binds what `Auth` and `SignInCodeDelivery.layerConfig` read: `authOrigin`, the Website's URL,
 * which Better Auth serves its endpoints and sets its cookie on, and what the `environment`
 * takes: on staging and production `mailed` delivery and the daily cap, elsewhere `inline`
 * delivery and no cap.
 */
export const bindSiteAuth = Effect.fn("Stack.bindSiteAuth")(function* (
  backend: BindableWorker,
  options: {
    readonly authOrigin: string | Output.Output<string | undefined>;
    readonly environment: SiteAuthEnvironment;
  },
) {
  const { delivery, dailyCap } = siteAuthOf(options.environment);
  yield* backend.bind(SITE_AUTH_BINDING, {
    env: {
      [SITE_AUTH_ENV.authOrigin]: options.authOrigin,
      [SITE_AUTH_ENV.delivery]: delivery,
      [SITE_AUTH_ENV.dailyCap]: dailyCap,
    },
  });
});

/** A site user the stage's seed writes: an admin, or a `user` a test signs in as. */
export interface SiteUserSeed {
  readonly email: string;
  readonly role: Role;
}

/** Fixed, so the seed's SQL, which the Action's input carries, stays the same across deploys. */
const SEEDED_AT = "2026-01-01T00:00:00.000Z";

const decodeEmail = Schema.decodeUnknownSync(Email);
const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * The SQL that writes `users` into Better Auth's `user` table as Better Auth stores a row (ISO
 * text instants, 0 or 1 booleans), one statement each. A user whose address is already there
 * keeps its id and takes the seed's role, and an admin the seed no longer lists becomes a `user`,
 * so the seed alone decides who is an admin.
 */
export const siteUserSeedSql = (users: readonly SiteUserSeed[]): string => {
  const admins = users
    .filter(({ role }) => role === "admin")
    .map(({ email }) => sqlText(decodeEmail(email)));
  return [
    `update user set role = 'user' where role = 'admin'${admins.length === 0 ? "" : ` and email not in (${admins.join(", ")})`};`,
    ...users.map(({ email, role }) => {
      const address = sqlText(decodeEmail(email));
      return `insert into user (id, name, email, emailVerified, role, banned, createdAt, updatedAt) values (${sqlText(`seed:${decodeEmail(email)}`)}, ${address}, ${address}, 1, ${sqlText(role)}, 0, '${SEEDED_AT}', '${SEEDED_AT}') on conflict (email) do update set role = excluded.role;`;
    }),
  ].join("\n");
};

const SiteUsersSeed = (database: Cloudflare.D1.Database) =>
  Alchemy.Action(
    "SiteUsersSeed",
    Effect.gen(function* () {
      const d1 = yield* Cloudflare.D1.QueryDatabase(database);
      return Effect.fn("SiteUsersSeed.run")(function* (input: {
        readonly databaseId: string;
        readonly sql: string;
      }) {
        yield* d1.exec(input.sql);
      });
    }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseLocal)),
  );

/**
 * Seeds the stage's site users into `database` after its migrations, the package's
 * `0000_sac_02_better_auth.sql` among them, then runs the app's own seed `sql`, when given, in
 * the same Action. The Action's input is the SQL and the database's id, so an edited list or seed
 * runs again and a recreated database is seeded again. Sign-in never creates an admin; this is
 * the one place one is made.
 */
export const seedSiteUsers = Effect.fn("Stack.seedSiteUsers")(function* (
  database: Cloudflare.D1.Database,
  users: readonly SiteUserSeed[],
  options: { readonly sql?: string } = {},
) {
  yield* SiteUsersSeed(database)({
    databaseId: database.databaseId,
    sql: [siteUserSeedSql(users), ...(options.sql === undefined ? [] : [options.sql])].join("\n"),
  });
});
