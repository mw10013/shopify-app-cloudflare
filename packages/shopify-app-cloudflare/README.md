# @mw10013/shopify-app-cloudflare

The shared foundation for embedded Shopify admin apps that run on Cloudflare Workers with Effect, TanStack Start and Alchemy. An app supplies its config, secrets, plan catalog, hooks, tables and shop actor; the package supplies the rest.

```sh
pnpm add @mw10013/shopify-app-cloudflare
```

The subpath exports are `/backend`, `/contract`, `/stack`, `/website`, `/website/react`, `/client`, `/test`, `/test/node`, `/test/e2e`, `/test/e2e/backend`, `/test/e2e/server` and `/test/e2e/config`. The Shopify dev tooling is `/dev/agent-chrome`, `/dev/app-handle`, `/dev/embedded-app`, `/dev/local-route`, `/dev/server`, `/dev/stage-store`, `/dev/stores`, `/dev/web` and `/dev/worktree`. The `/dev/*` modules and the e2e pack need the optional peers `@mw10013/rigging` (0.4 or later), `playwright` and `@effect/platform-node`; the servers run under the app's own `rigging server`. An app copies `migrations/` into its own D1 migrations and starts from a fresh database: the migrations create the `AppInstallation` table and Better Auth's tables but do not reconcile ones an app already has.

## Stores

`/dev/stores` answers which store an environment uses: `storeOf(environment)` leases a pool store to this checkout for `dev` and `e2e`, and returns `storeNameOf(stage, 0)` for `staging` and `production`. `adminUrlOf(environment, path)` builds the embedded app's admin URL from it and the `handle` in the environment's toml (`shopify.app.toml` for `dev`, `shopify.app.<environment>.toml` for the rest). The project is the app's `package.json` name and the checkout is its root.

The `stores` command runs inside an app with `vp exec stores`: `acquire <env>`, `show <env>`, `release [<env>]`, `list [--json]` and `pool ensure [<count>]`. State lives in `$XDG_STATE_HOME` (default `~/.local/state`): the lease ledger in `shopify-app-cloudflare/stores/ledger/` and the pool in `shopify-app-cloudflare/stores/pool.json`. Every file carries `"format": 1`, and a reader that finds another format fails before it writes, asking for a newer package.

## Orphan shop actor objects

An uninstall deletes the shop's row before it destroys the shop's `ShopActor`, so a destroy that failed leaves an object nothing accounts for. `ShopActorObjects` from `/backend` lists the stage's objects through Cloudflare's REST API, rules which are orphans and destroys one by id (`OrphanInstalledError` when the shop is installed again). `ShopActorObjects.layerConfig` needs `ShopActors` and `AppInstallations` in the Backend's init, `serveAdmin(yield* shopActorObjectMethods, shopActorObjectFailures)` serves the three behind the admin gate (see [Site sign-in](#site-sign-in)), and `ShopActorObjects.layerTest(pages)` lists a fixed set in an app's unit tests.

`bindShopActorObjects` from `/stack` binds `CLOUDFLARE_ACCOUNT_ID`, the script that hosts `ShopActor` and, only on staging and production, a Workers Scripts Read token as `CLOUDFLARE_WORKERS_API_TOKEN`. On any other stage listing dies saying so. `ShopActorObjectsPage` and `OrphanShopActorObjectsPage` from `/website/react` render the two admin pages from data and callbacks. The app keeps its route files and server functions, because TanStack Start's compiler is not known to rewrite a `createServerFn` under `node_modules`.

## Site sign-in

The site's own users (its admins, and Baton's members) sign in with a six-digit code sent by email, through Better Auth's email OTP plugin; there is no password and no magic link. `0000_sac_02_better_auth.sql` holds Better Auth's tables, and Better Auth runs with `migrate: false`.

- **Backend.** `Auth.layer({ signUp, databaseHooks? })` over `CloudflareD1(database)` from `@alchemy.run/better-auth`. `signUp` decides who may create a user on a first sign-in: `SIGN_UP_CLOSED` for only the seeded users, or an effectful predicate on the address. `SignInCodeDelivery.layerConfig({ appName })` over `Mailer.layer(email, { from })`, and `SignInLimiter.layer(rateLimit)` over the app's `Cloudflare.RateLimit`, which counts each code request against the client's IP and against the address. `serveAll(yield* signInMethods, signInFailures)` serves `requestSignInCode` and `signedInUser`; the Backend's `fetch` hands `/api/auth/*` to `Auth`'s `serve`, which answers only the code check and sign-out.
- **The admin gate.** `serveAdmin(methods, failures)` serves each method with the request's `RequestInfo` first, runs `requireAdmin` on it, and declares `UnauthorizedError` and `ForbiddenError` beside the method's own failures. The Website only redirects a signed-out visitor to sign-in.
- **Stack.** `bindSiteAuth(backend, { authOrigin, environment })` binds the Website's URL and the environment's delivery: `mailed` on staging and production, `inline` (the code comes back to the page) everywhere else. `seedSiteUsers(database, [{ email, role: "admin" }])` is the only way an admin is made.
- **Control door.** Mount `SiteAuthControlRpcs` with `siteAuthControlHandlers`: `IssueSignInCode` answers a code in one call, never mailed, for a test runner on a stage that mails codes.
- **Website.** The app's `api.auth.$` route is `server: { handlers: authHandlers(env) }`. Its server function for a code is `signInCodeResult(backend().requestSignInCode(requestInfoOf(getRequest()), data))`. `SignInPage` and `SignOutButton` come from `/website/react`.
- **Tests.** `SiteAuthTest` from `/test/node` runs it all over `D1Test`.

## Upgrading to 0.8

`/dev/berth` is gone: `acquire`, `acquireSync` and `LeaseNotGrantedError` become `storeOf` from `/dev/stores`, and `StoreName`, `storeNameOf` and `StoreFor` move there from `/dev/worktree`. `shopifyE2eConfig` is async: `await` it at the top level of `playwright.config.ts`. Delete `berth.json`; the toml of each environment is fixed by convention.

## Upgrading from 0.5

0.6 removes `runningServerSync` from `/dev/server` and changes `routeAppToLocal` in `/dev/local-route`. Update every caller, scripts included, not only `playwright.config.ts`:

- `runningServerSync(environment, app)` becomes `runningServer(environment, root)` from `@mw10013/rigging/core/test`. It takes the app root as a string, and returns `{ port, url, localURL }`, where `url` is a `string | null`, not an `Option`. It throws when the server is not running.
- `routeAppToLocal(context, server)` takes `{ port, tunnel }`. In a Playwright config that is `app.server` from `shopifyE2eConfig`. Elsewhere it is `{ port, tunnel: url }` from `runningServer`, once you have checked that `url` is not null.

## Testing

An app's Vitest projects are rigging's presets (`@mw10013/rigging/core/test`, `/core/browser-test` and `/cloudflare/test`). Its Playwright config is `shopifyE2eConfig` from `/test/e2e/config`: rigging's `e2eConfig` with the app read from its e2e lease, its running e2e server and its tomls, the spec pack's projects and preflight, one worker, and traces off unless `E2E_TRACE=1`. The app supplies what only it knows, spreads the config and appends its own projects:

```ts
// playwright.config.ts
import { app } from "@mw10013/rigging/core/app";
import { appBaseUrl, e2eProject } from "@mw10013/shopify-app-cloudflare/test/e2e";
import { shopifyE2eConfig } from "@mw10013/shopify-app-cloudflare/test/e2e/config";
import { defineConfig } from "playwright/test";

const { root } = app(import.meta.dirname);
const { app: myApp, config } = await shopifyE2eConfig({
  root,
  plans: [
    { handle: "my-app-basic", name: "Basic" },
    { handle: "my-app-pro", name: "Pro" },
  ],
  restart: ["vpx", "--env-file=.env", "scripts/e2e.ts", "reinstall"],
});

export default defineConfig({
  ...config,
  projects: [
    ...config.projects,
    e2eProject(myApp, root, {
      name: "embedded",
      testDir: "test/e2e/embedded",
      testMatch: "**/*.spec.ts",
      use: { channel: "chrome", baseURL: `${appBaseUrl(myApp)}/app` },
    }),
  ],
});
```

The source and its design live in https://github.com/mw10013/shopify-app-cloudflare, under `packages/shopify-app-cloudflare`.
