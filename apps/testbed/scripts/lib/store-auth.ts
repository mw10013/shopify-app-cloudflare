/**
 * Store auth for a leased store: the Shopify CLI's online token that `shopify store execute`
 * uses, so scripts and the e2e suite can read the store's Admin API. A pool store arrives in
 * whatever state its last holder left it, so {@link authorizeStore} checks first and does nothing
 * when the store already has every scope.
 *
 * @module
 */

import path from "node:path";
import process from "node:process";

import { runCommand } from "@mw10013/devkit/core/command";
import {
  AGENT_CDP,
  checkShopifyLogin,
  ensureAgentChrome,
} from "@mw10013/devkit/shopify/agent-chrome";
import { StoreFor } from "@mw10013/devkit/shopify/worktree";
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

export class StoreAuthError extends Schema.TaggedError<StoreAuthError>()("StoreAuthError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * The scopes store auth asks for. The testbed's app asks for none, and the CLI requires at least
 * one; `read_products` is the narrowest that lets the e2e suite read the store.
 */
export const STORE_SCOPES = ["read_products"] as const;

/** Shopify's `write_X` includes `read_X`, and the CLI lists only the scopes it was asked for. */
export const missingScopes = (granted: readonly string[]): string[] =>
  STORE_SCOPES.filter(
    (scope) => !granted.includes(scope) && !granted.includes(scope.replace(/^read_/u, "write_")),
  );

const domainOf = (store: string) => `${store}.myshopify.com`;

/** Never production, whose store is merchants'. */
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

const hasStoreAuth = Effect.fn("StoreAuth.hasStoreAuth")(function* (domain: string) {
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
  const session = sessions.find(({ store }) => store === domain);
  return session !== undefined && missingScopes(session.scopes).length === 0;
});

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
 * `shopify store auth` opens its URL in the default browser, so a stand-in `open` first on its
 * `PATH` catches the URL for the agent Chrome to approve. A lapsed Shopify login in the agent
 * Chrome fails for a person to fix.
 */
export const authorizeStore = Effect.fn("StoreAuth.authorizeStore")(function* (store: string) {
  yield* requireTestStore(store);
  const domain = domainOf(store);
  if (yield* hasStoreAuth(domain)) {
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
    ["store", "auth", "--store", domain, "--scopes", STORE_SCOPES.join(",")],
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
  if (!(yield* hasStoreAuth(domain)))
    return yield* new StoreAuthError({
      message: `${domain}: shopify store auth finished, but the store's session lacks ${STORE_SCOPES.join(", ")}`,
    });
  yield* Console.log(`ok    ${store}: store auth has every scope`);
}, Effect.scoped);
