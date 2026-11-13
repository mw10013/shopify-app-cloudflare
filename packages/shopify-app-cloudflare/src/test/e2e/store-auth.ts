/**
 * Store auth: the Shopify CLI's online token that `shopify store execute` uses, which an app's
 * suite and scripts need to read the store's Admin API. The preflight checks it
 * ({@link storeAuthMissing}); the e2e server's `start` grants it ({@link authorizeStore}).
 *
 * @module
 */

import path from "node:path";
import process from "node:process";

import { runCommand } from "@mw10013/rigging/core/command";
import * as Array from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { chromium } from "playwright";

import { AGENT_CDP, checkShopifyLogin, ensureAgentChrome } from "#dev/agent-chrome.ts";
import { StoreFor } from "#dev/stores.ts";

export class StoreAuthError extends Schema.TaggedError<StoreAuthError>()("StoreAuthError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** The scopes of `wanted` that `granted` lacks: Shopify's `write_X` includes `read_X`. */
export const missingScopes = (wanted: readonly string[], granted: readonly string[]): string[] =>
  wanted.filter(
    (scope) => !granted.includes(scope) && !granted.includes(scope.replace(/^read_/u, "write_")),
  );

/**
 * The CLI prints progress events, one JSON object per line, then the result as one pretty-printed
 * object over several lines, so the result is the last object, not the last line.
 */
export const resultText = (stdout: string): string => {
  const lines = stdout.split("\n").filter((line) => line !== "");
  const last = lines.at(-1) ?? "";
  if (last !== "}" && last !== "]") return last;
  const start = lines.lastIndexOf(last === "}" ? "{" : "[");
  return lines.slice(Math.max(start, 0)).join("\n");
};

const AuthList = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({ decode: resultText, encode: (text) => text }),
  ),
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Struct({
        sessions: Schema.Array(
          Schema.Struct({ store: Schema.String, scopes: Schema.Array(Schema.String) }),
        ),
      }),
    ),
  ),
);

/**
 * The scopes `shop`'s store auth lacks, every one of `wanted` when the CLI holds no session for
 * it.
 */
export const storeAuthMissing = Effect.fn("StoreAuth.missing")(function* (
  shop: string,
  wanted: readonly string[],
) {
  const stdout = yield* runCommand("shopify", [
    "store",
    "auth",
    "list",
    "--json",
    "--no-input",
  ]).pipe(Effect.mapError((error) => new StoreAuthError({ message: error.message, cause: error })));
  const { sessions } = yield* Schema.decodeUnknownEffect(AuthList)(stdout).pipe(
    Effect.mapError(
      (error) =>
        new StoreAuthError({
          message: `shopify store auth list printed a result that is not the expected shape: ${error.message}`,
          cause: error,
        }),
    ),
  );
  const session = sessions.find(({ store }) => store === shop);
  return session === undefined ? [...wanted] : missingScopes(wanted, session.scopes);
});

const requireTestStore = (store: string) =>
  Schema.decodeUnknownEffect(StoreFor(["pool", "staging"], "a pool or staging store"))(store).pipe(
    Effect.mapError(
      (error) =>
        new StoreAuthError({
          message: `${store} is not a pool or staging store (mw10013-pool-NN, mw10013-staging-shop-NN)`,
          cause: error,
        }),
    ),
  );

/** A store that already granted every scope redirects with no button to press. */
const approveInAgentChrome = (url: string) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => chromium.connectOverCDP(AGENT_CDP),
      catch: () => new StoreAuthError({ message: `Playwright could not connect to ${AGENT_CDP}.` }),
    }),
    (browser) =>
      Effect.tryPromise({
        try: async () => {
          const context = Option.getOrThrow(Array.head(browser.contexts()));
          const page = await context.newPage();
          try {
            await page.goto(url);
            const callback = page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 60_000 });
            const approve = page.getByRole("button", { name: /^(?:Install|Update)$/u });
            await Promise.race([callback, approve.click({ timeout: 60_000 }).then(() => callback)]);
          } finally {
            await page.close();
          }
        },
        catch: (cause) =>
          new StoreAuthError({
            message: `Shopify's authorization page did not reach the CLI's callback in the agent Chrome: ${String(cause)}`,
            cause,
          }),
      }),
    // Closing a browser connected over CDP only disconnects; the agent Chrome keeps running.
    (browser) => Effect.promise(() => browser.close()),
  );

/**
 * Grants `store` store auth with `scopes`, approving Shopify's page in the agent Chrome. A pool
 * store arrives in whatever state its last holder left it, so this checks first and does nothing
 * when the store already has every scope. `shopify store auth` opens its URL in the default
 * browser, so a stand-in `open` first on its `PATH` catches the URL for the agent Chrome to
 * approve. A lapsed Shopify login in the agent Chrome fails for a person to fix.
 */
export const authorizeStore = Effect.fn("StoreAuth.authorizeStore")(function* (
  store: string,
  scopes: readonly string[],
) {
  yield* requireTestStore(store);
  const domain = `${store}.myshopify.com`;
  if ((yield* storeAuthMissing(domain, scopes)).length === 0) {
    yield* Console.log(`ok    ${store}: store auth already has every scope`);
    return;
  }
  yield* ensureAgentChrome.pipe(
    Effect.mapError((error) => new StoreAuthError({ message: error.message, cause: error })),
  );
  yield* checkShopifyLogin(store).pipe(
    Effect.mapError((error) => new StoreAuthError({ message: error.message, cause: error })),
  );
  const fs = yield* FileSystem.FileSystem;
  const bin = yield* fs.makeTempDirectoryScoped();
  const urlFile = path.join(bin, "url");
  yield* fs.writeFileString(
    path.join(bin, "open"),
    `#!/bin/sh\nprintf '%s' "$1" > '${urlFile}'\n`,
    { mode: 0o755 },
  );
  const cli = yield* runCommand(
    "shopify",
    ["store", "auth", "--store", domain, "--scopes", scopes.join(",")],
    "",
    { PATH: `${bin}:${process.env.PATH ?? ""}` },
  ).pipe(
    Effect.mapError((error) => new StoreAuthError({ message: error.message, cause: error })),
    Effect.forkScoped,
  );
  const url = yield* fs.readFileString(urlFile).pipe(
    Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.during("30 seconds")])),
    Effect.mapError(
      () => new StoreAuthError({ message: "shopify store auth opened no authorization page" }),
    ),
  );
  yield* approveInAgentChrome(url);
  yield* Fiber.join(cli);
  if ((yield* storeAuthMissing(domain, scopes)).length > 0)
    return yield* new StoreAuthError({
      message: `${domain}: shopify store auth finished, but the store's session lacks ${scopes.join(", ")}`,
    });
  yield* Console.log(`ok    ${store}: store auth has every scope`);
}, Effect.scoped);
