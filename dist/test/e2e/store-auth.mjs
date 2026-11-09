import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Fiber from "effect/Fiber";
import path from "node:path";
import process from "node:process";
import { StoreFor } from "@mw10013/devkit/shopify/worktree";
import * as Console from "effect/Console";
import * as FileSystem from "effect/FileSystem";
import { runCommand } from "@mw10013/devkit/core/command";
import { AGENT_CDP, checkShopifyLogin, ensureAgentChrome } from "@mw10013/devkit/shopify/agent-chrome";
import * as Array from "effect/Array";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { chromium } from "playwright";
// src/test/e2e/store-auth.ts
/**
* Store auth: the Shopify CLI's online token that `shopify store execute` uses, which an app's
* suite and scripts need to read the store's Admin API. The preflight checks it
* ({@link storeAuthMissing}); the e2e server's `start` grants it ({@link authorizeStore}).
*
* @module
*/
var StoreAuthError = class extends Schema.TaggedError()("StoreAuthError", {
	message: Schema.String,
	cause: Schema.optionalKey(Schema.Defect())
}) {};
/** The scopes of `wanted` that `granted` lacks: Shopify's `write_X` includes `read_X`. */
const missingScopes = (wanted, granted) => wanted.filter((scope) => !granted.includes(scope) && !granted.includes(scope.replace(/^read_/u, "write_")));
/**
* The CLI prints progress events, one JSON object per line, then the result as one pretty-printed
* object over several lines, so the result is the last object, not the last line.
*/
const resultText = (stdout) => {
	const lines = stdout.split("\n").filter((line) => line !== "");
	const last = lines.at(-1) ?? "";
	if (last !== "}" && last !== "]") return last;
	const start = lines.lastIndexOf(last === "}" ? "{" : "[");
	return lines.slice(Math.max(start, 0)).join("\n");
};
const AuthList = Schema.String.pipe(Schema.decodeTo(Schema.String, SchemaTransformation.transform({
	decode: resultText,
	encode: (text) => text
})), Schema.decodeTo(Schema.fromJsonString(Schema.Struct({ sessions: Schema.Array(Schema.Struct({
	store: Schema.String,
	scopes: Schema.Array(Schema.String)
})) }))));
/**
* The scopes `shop`'s store auth lacks, every one of `wanted` when the CLI holds no session for
* it.
*/
const storeAuthMissing = Effect.fn("StoreAuth.missing")(function* (shop, wanted) {
	const stdout = yield* runCommand("shopify", [
		"store",
		"auth",
		"list",
		"--json",
		"--no-input"
	]).pipe(Effect.mapError((error) => new StoreAuthError({
		message: error.message,
		cause: error
	})));
	const { sessions } = yield* Schema.decodeUnknownEffect(AuthList)(stdout).pipe(Effect.mapError((error) => new StoreAuthError({
		message: `shopify store auth list printed a result that is not the expected shape: ${error.message}`,
		cause: error
	})));
	const session = sessions.find(({ store }) => store === shop);
	return session === void 0 ? [...wanted] : missingScopes(wanted, session.scopes);
});
/** Never production, whose store is merchants'. */
const requireTestStore = (store) => Schema.decodeUnknownEffect(StoreFor(["pool", "staging"], "a pool or staging store"))(store).pipe(Effect.mapError((error) => new StoreAuthError({
	message: `${store} is not a pool or staging store (mw10013-pool-NN, mw10013-staging-shop-NN)`,
	cause: error
})));
/** A store that already granted every scope redirects with no button to press. */
const approveInAgentChrome = (url) => Effect.acquireUseRelease(Effect.tryPromise({
	try: () => chromium.connectOverCDP(AGENT_CDP),
	catch: () => new StoreAuthError({ message: `Playwright could not connect to ${AGENT_CDP}.` })
}), (browser) => Effect.tryPromise({
	try: async () => {
		const page = await Option.getOrThrow(Array.head(browser.contexts())).newPage();
		try {
			await page.goto(url);
			const callback = page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 6e4 });
			const approve = page.getByRole("button", { name: /^(?:Install|Update)$/u });
			await Promise.race([callback, approve.click({ timeout: 6e4 }).then(() => callback)]);
		} finally {
			await page.close();
		}
	},
	catch: (cause) => new StoreAuthError({
		message: `Shopify's authorization page did not reach the CLI's callback in the agent Chrome: ${String(cause)}`,
		cause
	})
}), (browser) => Effect.promise(() => browser.close()));
/**
* Grants `store` store auth with `scopes`, approving Shopify's page in the agent Chrome. A pool
* store arrives in whatever state its last holder left it, so this checks first and does nothing
* when the store already has every scope. `shopify store auth` opens its URL in the default
* browser, so a stand-in `open` first on its `PATH` catches the URL for the agent Chrome to
* approve. A lapsed Shopify login in the agent Chrome fails for a person to fix.
*/
const authorizeStore = Effect.fn("StoreAuth.authorizeStore")(function* (store, scopes) {
	yield* requireTestStore(store);
	const domain = `${store}.myshopify.com`;
	if ((yield* storeAuthMissing(domain, scopes)).length === 0) {
		yield* Console.log(`ok    ${store}: store auth already has every scope`);
		return;
	}
	yield* ensureAgentChrome.pipe(Effect.mapError((error) => new StoreAuthError({
		message: error.message,
		cause: error
	})));
	yield* checkShopifyLogin(store).pipe(Effect.mapError((error) => new StoreAuthError({
		message: error.message,
		cause: error
	})));
	const fs = yield* FileSystem.FileSystem;
	const bin = yield* fs.makeTempDirectoryScoped();
	const urlFile = path.join(bin, "url");
	yield* fs.writeFileString(path.join(bin, "open"), `#!/bin/sh\nprintf '%s' "$1" > '${urlFile}'\n`, { mode: 493 });
	const cli = yield* runCommand("shopify", [
		"store",
		"auth",
		"--store",
		domain,
		"--scopes",
		scopes.join(",")
	], "", { PATH: `${bin}:${process.env.PATH ?? ""}` }).pipe(Effect.mapError((error) => new StoreAuthError({
		message: error.message,
		cause: error
	})), Effect.forkScoped);
	const url = yield* fs.readFileString(urlFile).pipe(Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.during("30 seconds")])), Effect.mapError(() => new StoreAuthError({ message: "shopify store auth opened no authorization page" })));
	yield* approveInAgentChrome(url);
	yield* Fiber.join(cli);
	if ((yield* storeAuthMissing(domain, scopes)).length > 0) return yield* new StoreAuthError({ message: `${domain}: shopify store auth finished, but the store's session lacks ${scopes.join(", ")}` });
	yield* Console.log(`ok    ${store}: store auth has every scope`);
}, Effect.scoped);
export { StoreAuthError, authorizeStore, missingScopes, resultText, storeAuthMissing };
