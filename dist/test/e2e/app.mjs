import * as Schema from "effect/Schema";
import path from "node:path";
import process from "node:process";
import { storageStatePath } from "@mw10013/devkit/shopify/agent-chrome";
// src/test/e2e/app.ts
/**
* The end-to-end spec pack's app adapter and its Playwright projects. An app registers the pack
* from its own `playwright.config.ts`: it describes itself as an {@link E2eApp} and spreads
* {@link e2eProjects} into its `projects`, with {@link E2E_PREFLIGHT} as a `globalSetup`.
*
* @module
*/
/** A plan as the app's `PlanCatalog` sells it and as Shopify's plan selection page names its card. */
const E2ePlan = Schema.Struct({
	handle: Schema.NonEmptyString,
	/** The plan's name in the Partner Dashboard, the heading of its card on the plan selection page. */
	name: Schema.NonEmptyString
});
/** The running e2e server: its local port, which the browser and the status reads use, and its tunnel. */
const E2eServer = Schema.Struct({
	port: Schema.Int,
	tunnel: Schema.NonEmptyString
});
/**
* What the pack needs of an app: its leased store, its identity and plans, its running e2e server,
* how to read the server's e2e status route and how to restart the server. Plain data, because
* Playwright hands project options to the preflight and to every worker.
*/
const E2eApp = Schema.Struct({
	/** The leased store's handle: `<store>` in `<store>.myshopify.com` and in admin URLs. */
	store: Schema.NonEmptyString,
	/** The app's handle, which names it in admin URLs: `/apps/<handle>`, `/charges/<handle>`. */
	appHandle: Schema.NonEmptyString,
	/** The app's client ID, which its admin install URL names. */
	clientId: Schema.NonEmptyString,
	/**
	* The plans the app sells, cheapest first. The lifecycle spec subscribes to the first and
	* changes to the second when there is one.
	*/
	plans: Schema.NonEmptyArray(E2ePlan),
	server: E2eServer,
	/**
	* The e2e status route on the server's local port, answering `GET <path>?shop=<shop>` with an
	* `E2eShopStatus` when sent `headers`.
	*/
	status: Schema.Struct({
		path: Schema.String.check(Schema.isStartingWith("/")),
		headers: Schema.Record(Schema.String, Schema.String)
	}),
	/**
	* The webhooks the webhook spec has Shopify deliver to the server's tunnel with `shopify app
	* webhook trigger`: the compliance topics, and `topics`, the app's own topics that are safe to
	* deliver for Shopify's sample shop, `shop.myshopify.com`. `config` is the absolute path of the
	* toml the e2e server serves, the app the Backend checks the HMAC for, whose subscriptions give
	* each topic's path and whose `[webhooks] api_version` the version; the CLI runs in its
	* directory. `record` is the e2e
	* webhook record on the server's local port, answering `GET <record>` with an
	* `E2eWebhookDeliveries` when sent the status route's `headers`.
	*/
	webhooks: Schema.Struct({
		config: Schema.NonEmptyString,
		topics: Schema.Array(Schema.NonEmptyString),
		record: Schema.String.check(Schema.isStartingWith("/"))
	}),
	/**
	* Restarts the e2e server on the same store, keeping its data and its status route's headers:
	* `command` run in `cwd`, printing the new {@link E2eServer} as JSON on its last line of stdout.
	* An uninstall ends the Shopify CLI's dev preview on the store (the CLI logs "The dev preview has
	* ended"), and only a new `shopify app dev` installs one again, so the lifecycle spec restarts
	* the server before it reinstalls.
	*/
	restart: Schema.Struct({
		command: Schema.NonEmptyArray(Schema.NonEmptyString),
		cwd: Schema.NonEmptyString
	}),
	/** The store auth scopes the app's suite needs; the preflight checks them when any are given. */
	storeScopes: Schema.Array(Schema.NonEmptyString)
});
/** The store's myshopify domain, the `shop` every Shopify surface names it by. */
const shopOf = (app) => `${app.store}.myshopify.com`;
/** The app in the store's admin: every pack spec's `baseURL`. */
const appBaseUrl = (app) => `https://admin.shopify.com/store/${app.store}/apps/${app.appHandle}`;
/**
* `path` on the server's local port. The status route's headers carry the session's token, so a
* path that resolves to another origin (`//other.example/x`) is refused rather than sent there.
*/
const localServerUrl = (app, path) => {
	const origin = `http://localhost:${String(app.server.port)}`;
	const url = new URL(path, origin);
	if (url.origin !== origin) throw new Error(`${path} resolves to ${url.origin}, not the e2e server's ${origin}`);
	return url;
};
/** The e2e status route's URL for `shop`, on the server's local port. */
const statusUrl = (app, shop) => {
	const url = localServerUrl(app, app.status.path);
	url.searchParams.set("shop", shop);
	return url;
};
/** The e2e webhook record's URL, on the server's local port. */
const webhookRecordUrl = (app) => localServerUrl(app, app.webhooks.record);
/** The pack's spec and setup files. */
const E2E_SPECS_DIR = import.meta.dirname;
/**
* The run's preflight, for the app's `globalSetup`. Its extension is this module's, so the path
* holds both in the source (`.ts`) and in the built package, whose JavaScript Playwright loads
* as is: it does not transpile TypeScript under `node_modules`.
*/
const E2E_PREFLIGHT = path.join(import.meta.dirname, `preflight${path.extname(import.meta.filename)}`);
/** A spec file, as source or built: `.spec.ts`, `.spec.js`, `.spec.mjs` and the like. */
const SPEC_MATCH = /\.spec\.[cm]?[jt]s$/u;
/** The project that exports the agent Chrome's Shopify login; the pack's specs depend on it. */
const SHOPIFY_ADMIN_PROJECT = "shopify-admin";
/**
* The project of the lifecycle spec, first after the login export: it recovers the store from any
* state and restarts the e2e server. Every later project runs in a worker of its own, which loads
* the app's config again and so reads the restarted server.
*/
const LIFECYCLE_PROJECT = "shopify-app-workers-lifecycle";
/** The project of the pack's specs but the lifecycle. */
const SPECS_PROJECT = "shopify-app-workers";
/** The lifecycle spec, as source or built. */
const LIFECYCLE_SPEC_MATCH = /lifecycle\.spec\.[cm]?[jt]s$/u;
/** Set to `1` to keep a trace of each failed test. */
const E2E_TRACE = "E2E_TRACE";
/**
* Whether this run keeps traces. Off by default: a trace holds the context's storage state (the
* live Shopify admin login) in its context options and the login's cookies in its network log,
* and the HTML report copies traces. `E2E_TRACE=1` opts in, with a warning from the main process.
*/
const traced = () => {
	if (process.env["E2E_TRACE"] !== "1") return false;
	if (process.env.TEST_WORKER_INDEX === void 0) console.warn(`${E2E_TRACE}=1: each failed test's trace and the HTML report hold a live Shopify admin login; do not share them, and delete the run's directory when done`);
	return true;
};
/**
* A project of specs on the pack's fixtures, inside the store's admin under the exported login,
* after {@link SHOPIFY_ADMIN_PROJECT}. The pack registers its own specs with it; an app adds its
* own the same way, next to {@link e2eProjects}. `root` is the app's directory, which holds the
* exported login under `playwright/.auth/`. Screenshots and videos are off, and traces unless
* {@link E2E_TRACE} opts in, because each can carry the login.
*/
const e2eProject = (app, root, { name, testDir, testMatch, testIgnore = [], after = [LIFECYCLE_PROJECT] }) => {
	const adminAuthFile = path.join(root, storageStatePath);
	return {
		name,
		testDir,
		testMatch,
		testIgnore,
		dependencies: [SHOPIFY_ADMIN_PROJECT, ...after],
		timeout: 6e4,
		expect: { timeout: 1e4 },
		use: {
			e2eApp: app,
			adminAuthFile,
			baseURL: appBaseUrl(app),
			storageState: adminAuthFile,
			actionTimeout: 1e4,
			navigationTimeout: 3e4,
			trace: traced() ? "retain-on-failure" : "off",
			screenshot: "off",
			video: "off"
		}
	};
};
/**
* The pack's projects: {@link SHOPIFY_ADMIN_PROJECT}, the lifecycle ({@link LIFECYCLE_PROJECT}),
* then its other specs ({@link e2eProject}). Every spec drives the one leased store, so the app's
* config runs them with `workers: 1`.
*/
const e2eProjects = (app, root) => [
	{
		name: SHOPIFY_ADMIN_PROJECT,
		testDir: E2E_SPECS_DIR,
		testMatch: /shopify-admin\.setup\.[cm]?[jt]s$/u,
		use: {
			e2eApp: app,
			adminAuthFile: path.join(root, storageStatePath)
		}
	},
	e2eProject(app, root, {
		name: LIFECYCLE_PROJECT,
		testDir: E2E_SPECS_DIR,
		testMatch: LIFECYCLE_SPEC_MATCH,
		after: []
	}),
	e2eProject(app, root, {
		name: SPECS_PROJECT,
		testDir: E2E_SPECS_DIR,
		testMatch: SPEC_MATCH,
		testIgnore: LIFECYCLE_SPEC_MATCH
	})
];
export { E2E_PREFLIGHT, E2E_SPECS_DIR, E2E_TRACE, E2eApp, E2ePlan, E2eServer, LIFECYCLE_PROJECT, LIFECYCLE_SPEC_MATCH, SHOPIFY_ADMIN_PROJECT, SPECS_PROJECT, SPEC_MATCH, appBaseUrl, e2eProject, e2eProjects, localServerUrl, shopOf, statusUrl, webhookRecordUrl };
