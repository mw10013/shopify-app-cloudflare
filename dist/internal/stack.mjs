import { AppHandle, SHOPIFY_BINDING, SHOPIFY_PARTNER_BINDING, partnerConfig } from "./bindings.mjs";
import { E2E_SESSION_BINDING, E2E_SESSION_FILE, E2eSessionJson, e2eSessionEnv } from "../test/e2e-session.mjs";
import { FAKE_APP_HANDLE, FAKE_SHOPIFY_API_KEY, FAKE_SHOPIFY_API_SECRET } from "../test/fake-app.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import * as Redacted from "effect/Redacted";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ConfigProvider from "effect/ConfigProvider";
// src/internal/stack.ts
/**
* Stack-time helpers: what an app's `alchemy.run.ts` binds to its Backend so the package's
* `layerConfig`s find it. Evaluated by `alchemy dev` and `alchemy deploy`; the Backend bundle
* never imports it. Which app a stage serves is the app's choice, a `Match` on its environment,
* so these helpers only read and bind.
*
* @module
*/
const decodeAppHandle = Schema.decodeUnknownSync(AppHandle);
/** A Shopify app's client ID, the toml's `client_id`, which is its API key: 32 hex digits. */
const ClientId = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9a-f]{32}$/u));
const decodeClientId = Schema.decodeUnknownSync(ClientId);
const pathOf = (tomlPath) => tomlPath instanceof URL ? fileURLToPath(tomlPath) : tomlPath;
/**
* The public identity of the app the toml at `tomlPath` configures: its top-level `handle` and
* `client_id`, read from the lines before the first table header. A stage's toml is the one place
* its app's identity is written, so the stack reads it rather than its environment. Throws,
* naming the path, when the file is missing or either key is absent or malformed.
*/
const readAppIdentity = (tomlPath) => {
	const where = pathOf(tomlPath);
	let contents;
	try {
		contents = readFileSync(tomlPath, "utf8");
	} catch (cause) {
		throw new Error(`readAppIdentity: cannot read ${where}`, { cause });
	}
	const values = /* @__PURE__ */ new Map();
	for (const raw of contents.split("\n")) {
		const line = raw.replace(/#.*$/u, "").trim();
		if (line.startsWith("[")) break;
		const match = /^(?<key>handle|client_id)\s*=\s*"(?<value>[^"]*)"$/u.exec(line)?.groups;
		if (match?.key !== void 0 && match.value !== void 0) values.set(match.key, match.value);
	}
	const value = (key) => {
		const found = values.get(key);
		if (found === void 0) throw new Error(`readAppIdentity: ${where} has no top-level ${key}`);
		return found;
	};
	return {
		handle: decodeAppHandle(value("handle")),
		apiKey: decodeClientId(value("client_id"))
	};
};
/** {@link readAppIdentity} as a `Config`, so a stage that never reaches it never reads the file. */
const appIdentityConfig = (tomlPath) => Config.succeed(tomlPath).pipe(Config.mapEffect((path) => Effect.try({
	try: () => readAppIdentity(path),
	catch: (cause) => new Config.ConfigError(new ConfigProvider.SourceError({
		message: cause instanceof Error ? cause.message : String(cause),
		cause
	}))
})));
/**
* Shopify CLI's app, `Some` only when `APP_URL`, `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are
* all present. The CLI injects them into the web command it runs, so they exist only under
* `shopify app dev`, which runs `alchemy dev` as that command; the process environment wins over
* `.env`, so `.env` cannot shadow them. The identity is the toml's at `tomlPath`, the one the
* CLI serves; the injected key must equal its `client_id`, else the CLI serves another app and
* this fails, naming both.
*/
const shopifyCliApp = (tomlPath) => Config.all({
	appUrl: Config.option(Config.String("APP_URL")),
	apiKey: Config.option(Config.String("SHOPIFY_API_KEY")),
	apiSecret: Config.option(Config.Redacted("SHOPIFY_API_SECRET"))
}).pipe(Config.map(Option.all), Config.mapEffect(Option.match({
	onNone: () => Effect.succeedNone,
	onSome: (cli) => Effect.flatMap(appIdentityConfig(tomlPath), (identity) => cli.apiKey === identity.apiKey ? Effect.succeed(Option.some({
		...cli,
		...identity
	})) : Effect.fail(new Config.ConfigError(new ConfigProvider.SourceError({ message: `shopifyCliApp: Shopify CLI serves SHOPIFY_API_KEY ${cli.apiKey}, but ${pathOf(tomlPath)} has client_id ${identity.apiKey}` }))))
})));
/**
* A deployed stage's app: its identity from the stage's toml at `tomlPath`, and only its secret,
* `SHOPIFY_API_SECRET`, from the deploy's environment, served at `appUrl` (the Website's own
* URL). A missing toml or secret fails the plan rather than falling back to the fake app.
*/
const deployedShopifyApp = (tomlPath, appUrl) => Config.all({
	identity: appIdentityConfig(tomlPath),
	apiSecret: Config.Redacted("SHOPIFY_API_SECRET")
}).pipe(Config.map(({ identity, apiSecret }) => ({
	...identity,
	apiSecret,
	appUrl
})));
/**
* The fake app served at `appUrl`: `/test`'s constants, which only a token or a webhook a test
* signs verifies against. For a stage with no real app (a test stage, or a bare `alchemy
* destroy` outside `shopify app dev`).
*/
const fakeShopifyApp = (appUrl) => ({
	handle: FAKE_APP_HANDLE,
	apiKey: FAKE_SHOPIFY_API_KEY,
	apiSecret: Redacted.make(FAKE_SHOPIFY_API_SECRET),
	appUrl
});
/** The Partner values a stage binds, read from `.env` or a deploy's environment. */
const partnerBindingFromConfig = partnerConfig;
/**
* Binds the Backend's Shopify configuration: the app as `SHOPIFY_APP_HANDLE`, `SHOPIFY_API_KEY`,
* `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL`, and, when `partner` is `Some`, the Partner
* credentials. With `None` none is bound, and the Backend's billing dies on its first Partner
* call while webhooks, the grantor and a shop with a cached plan work (`PartnerApi.layerUnbound`).
*/
const bindShopifyApp = Effect.fn("Stack.bindShopifyApp")(function* (backend, options) {
	yield* backend.bind(SHOPIFY_BINDING, { env: {
		SHOPIFY_APP_HANDLE: options.app.handle,
		SHOPIFY_API_KEY: options.app.apiKey,
		SHOPIFY_API_SECRET: options.app.apiSecret,
		SHOPIFY_APP_URL: options.app.appUrl
	} });
	if (Option.isSome(options.partner)) yield* backend.bind(SHOPIFY_PARTNER_BINDING, { env: options.partner.value });
});
const decodeE2eSession = Schema.decodeUnknownEffect(E2eSessionJson);
/**
* Binds the e2e session the e2e server's `start` wrote under `appRoot` to the `e2e` stage's
* Backend, which gates its e2e routes with it (`withE2eRoutes` in `/test/e2e/backend`). Binds
* nothing when the file is absent (a bare `alchemy destroy`), and the routes then answer every
* request 401. Only the `e2e` stage calls it: the app's stack picks the stage, as it picks the
* Backend Worker that serves the routes.
*/
const bindE2eSession = Effect.fn("Stack.bindE2eSession")(function* (backend, appRoot) {
	const file = path.join(pathOf(appRoot), E2E_SESSION_FILE);
	if (!existsSync(file)) return;
	const session = yield* decodeE2eSession(readFileSync(file, "utf8"));
	yield* backend.bind(E2E_SESSION_BINDING, { env: e2eSessionEnv(session) });
});
export { bindE2eSession, bindShopifyApp, deployedShopifyApp, fakeShopifyApp, partnerBindingFromConfig, readAppIdentity, shopifyCliApp };
