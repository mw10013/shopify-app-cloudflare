/**
 * The `app-token-key` command. `new` writes a fresh key to an env file and prints its public JWK
 * alone on stdout, so it pipes to the clipboard, with the next steps on stderr. `verify` mints once
 * and prints whether Shopify accepts the key. A failure, or a key Shopify refuses, exits 1; a
 * usage error exits 2. The file flag is `--dotenv`, not `--env-file`: Node exits 9 on
 * `--env-file <file>` anywhere in its argv when the file is missing, before the bin runs.
 *
 * @module
 */
import * as path from "node:path";

import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { type AppIdentity, readAppIdentity } from "#internal/app-identity.ts";
import { importAppTokenKey } from "#internal/app-token-assertion.ts";
import { ShopDomain } from "#internal/domain.ts";

import { readEnv, setEnv } from "./env-file.ts";
import { generateKey, KEY_VARIABLE, KID_VARIABLE, kidFor } from "./key.ts";
import { type Registration, verify as verifyKey } from "./verify.ts";

class AppConfigError extends Data.TaggedError("AppConfigError")<{ readonly message: string }> {}

class DotenvKeyMissingError extends Data.TaggedError("DotenvKeyMissingError")<{
  readonly dotenv: string;
  readonly variable: string;
}> {
  override get message() {
    return `${this.dotenv} has no ${this.variable}: run app-token-key new first`;
  }
}

const identityOf = (config: string) =>
  Effect.try({
    try: (): AppIdentity => readAppIdentity(config),
    catch: (cause) =>
      new AppConfigError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });

const readDotenv = Effect.fnUntraced(function* (dotenv: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(dotenv)) ? yield* fs.readFileString(dotenv) : "";
});

/** The stage a `.env.<stage>` file holds; `.env` itself is the local stages'. */
const stageOf = (dotenv: string) =>
  Option.fromNullishOr(/^\.env\.(?<stage>.+)$/u.exec(path.basename(dotenv))?.groups?.stage);

const exitWith = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const report = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) =>
      Console.error(`app-token-key: ${error.message}`).pipe(Effect.andThen(exitWith(1))),
    ),
  );

const config = Flag.File("config", { mustExist: true }).pipe(
  Flag.withDescription("The app's toml: shopify.app.toml or shopify.app.<name>.toml"),
);

const dotenv = Flag.String("dotenv").pipe(
  Flag.withDescription("The env file that holds the key: .env or .env.<stage>"),
);

const newKey = Command.make("new", { config, dotenv }, (flags) =>
  report(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { handle } = yield* identityOf(flags.config);
      const text = yield* readDotenv(flags.dotenv);
      const previous = Option.fromNullishOr(readEnv(text).get(KID_VARIABLE));
      const kid = kidFor(handle, yield* DateTime.now, previous);
      const { key, jwk } = yield* generateKey(kid);
      yield* fs.writeFileString(
        flags.dotenv,
        setEnv(text, { [KEY_VARIABLE]: Redacted.value(key), [KID_VARIABLE]: kid }),
        { mode: 0o600 },
      );
      yield* Console.log(JSON.stringify(jwk, null, 2));
      const verifyCommand = `vp exec app-token-key verify --config ${flags.config} --dotenv ${flags.dotenv} --shop <shop>.myshopify.com`;
      yield* Console.error(
        [
          `app-token-key: wrote ${KEY_VARIABLE} and ${KID_VARIABLE}=${kid} to ${flags.dotenv}`,
          "",
          "Next:",
          `  1. Register the public JWK above: Dev Dashboard > ${handle} > Settings > Credentials > Public keys > Add key.`,
          `  2. Store ${KEY_VARIABLE} from ${flags.dotenv} in KeePassXC under ${kid}.`,
          ...Option.match(stageOf(flags.dotenv), {
            onNone: () => [`  3. Check it: ${verifyCommand}`],
            onSome: (stage) => [
              `  3. Check it: ${verifyCommand}`,
              `  4. Push it to the stage: vp run stage up ${stage}`,
            ],
          }),
          ...Option.match(previous, {
            onNone: () => [],
            onSome: (old) => [
              "",
              `Rotation: keep ${old} registered until the tokens it signed expire, an hour after the new key deploys. Then revoke ${old} in the Dev Dashboard.`,
            ],
          }),
        ].join("\n"),
      );
    }),
  ),
).pipe(
  Command.withShortDescription("Write a new signing key to an env file and print its public JWK"),
  Command.withExamples([
    {
      command: "app-token-key new --config shopify.app.toml --dotenv .env | pbcopy",
      description: "Make the dev app's key and copy its JWK to paste in the Dev Dashboard",
    },
  ]),
);

const outcomeOf = (kid: string, shop: ShopDomain) =>
  Match.type<Registration>().pipe(
    Match.tagsExhaustive({
      Installed: () => ({
        registered: true,
        line: `registered: ${kid} minted a token for ${shop}, which has the app installed`,
      }),
      NotInstalled: () => ({
        registered: true,
        line: `registered: Shopify accepts ${kid}; ${shop} does not have the app installed (400 app_not_installed)`,
      }),
      NotRegistered: () => ({
        registered: false,
        line: `not registered: Shopify refused ${kid} (401 invalid_client). Register its public JWK in the Dev Dashboard, or check ${KID_VARIABLE}.`,
      }),
      Refused: ({ status, error }) => ({
        registered: false,
        line: `unexpected answer: ${String(status)} error=${error}`,
      }),
    }),
  );

const verify = Command.make(
  "verify",
  {
    config,
    dotenv: Flag.File("dotenv", { mustExist: true }).pipe(
      Flag.withDescription("The env file that holds the key: .env or .env.<stage>"),
    ),
    shop: Flag.String("shop").pipe(
      Flag.withSchema(ShopDomain),
      Flag.withDescription("Any existing store: <name>.myshopify.com"),
    ),
  },
  (flags) =>
    report(
      Effect.gen(function* () {
        const { apiKey } = yield* identityOf(flags.config);
        const values = readEnv(yield* readDotenv(flags.dotenv));
        const variable = (name: string) =>
          Option.match(Option.fromNullishOr(values.get(name)), {
            onNone: () =>
              Effect.fail(new DotenvKeyMissingError({ dotenv: flags.dotenv, variable: name })),
            onSome: Effect.succeed,
          });
        const kid = yield* variable(KID_VARIABLE);
        const key = yield* importAppTokenKey(Redacted.make(yield* variable(KEY_VARIABLE)));
        const registration = yield* verifyKey({ clientId: apiKey, kid, key }, flags.shop);
        const { registered, line } = outcomeOf(kid, flags.shop)(registration);
        yield* Console.log(line);
        if (!registered) yield* exitWith(1);
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    ),
).pipe(
  Command.withShortDescription("Mint once to check that Shopify accepts the env file's key"),
  Command.withExamples([
    {
      command:
        "app-token-key verify --config shopify.app.toml --dotenv .env --shop mw10013-pool-01.myshopify.com",
      description: "Check the dev app's key against a pool store",
    },
  ]),
);

export const command = Command.make("app-token-key").pipe(
  Command.withDescription(
    "Make and check the key a Shopify app signs its application-only token requests with.",
  ),
  Command.withSubcommands([newKey, verify]),
);
