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

An uninstall deletes the shop's row before it destroys the shop's `ShopActor`, so a destroy that failed leaves an object nothing accounts for. `ShopActorObjects` from `/backend` lists the stage's objects through Cloudflare's REST API, rules which are orphans and destroys one by id (`OrphanInstalledError` when the shop is installed again). `ShopActorObjects.layerConfig` needs `ShopActors` and `AppInstallations` in the Backend's init, `yield* shopActorObjectMethods` serves the three behind the admin gate (see [Site sign-in](#site-sign-in)), with no unguarded form, and `ShopActorObjects.layerTest(pages)` lists a fixed set in an app's unit tests.

`bindShopActorObjects` from `/stack` binds `CLOUDFLARE_ACCOUNT_ID`, the script that hosts `ShopActor` and, only on staging and production, a Workers Scripts Read token as `CLOUDFLARE_WORKERS_API_TOKEN`. On any other stage listing dies saying so. Their two admin pages are `adminShopActorObjects` and `adminOrphanShopActorObjects` in [Admin pages](#admin-pages).

## Admin pages

Every app's admin section is the same pages from the package, under one `/admin` layout. The route tree is the section's navigation: a route joins it by declaring `staticData.admin`, and the layout draws the page around it.

```
/admin                        adminLayout: the page, its heading, breadcrumb, Sign out and errors
  /                           adminHome: lists /admin's children that have a summary
  /shops                      adminShops
    /                         adminShopsList({ load })
    /$shop                    adminShop: the shop domain as heading, a tab per child route
      /                       adminShopOverview({ load, refreshPlan }): the Overview tab
  /shop-actor-objects         adminShopActorObjects({ load })
  /orphan-shop-actor-objects  adminOrphanShopActorObjects({ load, destroy })
/admin_/sign-in               SignInPage
```

- **Backend.** `yield* adminShopMethods(catalog)` serves `appInstallationsPage`, `adminShop` and `refreshPlan` behind the admin gate. It needs `AppInstallations`, `SubscriptionPlan` and `ShopActors`. Viewing a shop reads its cached plan and never calls Shopify; Refresh plan re-reads it, and declares `ShopifyUnavailableError`.
- **Website.** One server function per method, each `backend().<method>(requestInfo(), data)`, decoded with the answer's schema from `/contract`, its admin refusal redirecting to `/admin/sign-in` with the page's path. The Website registers a `DateTime.Utc` serialization adapter, since the rows carry instants.
- **Routes.** Each route file spreads the package's route options into `createFileRoute`, or passes them whole. A page that loads data or acts is a function of the app's server functions, which must be created in app code: TanStack Start's compiler is not known to rewrite a `createServerFn` under `node_modules`. The package owns everything else: the component, `validateSearch` (a stale or malformed cursor or search reads as the first page), `loaderDeps`, `staleReloadMode: "blocking"` and the `$shop` param's parse. The app adds only its guard, a `beforeLoad` on `/admin`.

```ts
export const Route = createFileRoute("/admin")({
  ...adminLayout,
  beforeLoad: async ({ location }) => {
    if ((await getSignedInUser()) === null)
      throw redirect({ to: "/admin/sign-in", search: { redirect: location.href } });
  },
});

export const Route = createFileRoute("/admin/shops/$shop/")(
  adminShopOverview({ load: getAdminShop, refreshPlan }),
);
```

- **Navigation.** A route's `staticData.admin` is `{ title, summary?, order? }`. The heading is the deepest matched route's `title`, and the breadcrumb links to the matched route above it that has one. The home page lists `/admin`'s children that have a `summary`, by `order` (the package's take 10, 20 and 30). `title` may be a function of the route's params, as the shop page's is; such a route has no `summary`. A failure anywhere under `/admin` is a critical banner inside the same page, with its heading, breadcrumb and Sign out.
- **An app's own page.** A child route of `/admin` with `staticData: { admin: { title, summary, order } }` whose component renders `s-section`s, never an `s-page`. It appears on the home page.
- **An app's own tab.** A child route of `/admin/shops/$shop` with `staticData: { adminTab: { label, order } }` (`order` 10 and up; Overview is 0) that renders sections.
- **Fields.** `Fields`, `Field` and `Instant` from `/website/react` lay out read-only values as the package's pages do. `Instant` renders a `<time>` in UTC ISO on the server and in the viewer's zone once hydrated.

## Site sign-in

The site's own users (its admins, and Baton's members) sign in with a six-digit code sent by email, through Better Auth's email OTP plugin; there is no password and no magic link. `0000_sac_02_better_auth.sql` holds Better Auth's tables and the package's `SignInCodeCount`, and Better Auth runs with `migrate: false`.

- **Backend.** `Auth.layer({ signUp, databaseHooks? })` over `CloudflareD1(database)` from `@alchemy.run/better-auth`. `signUp` decides who may create a user on a first sign-in: `SIGN_UP_CLOSED` for only the seeded users, or an effectful predicate on the address. `SignInCodeDelivery.layerConfig({ appName })` over `Mailer.layer(email, { from })`, and `SignInLimiter.layer(rateLimit)` over the app's `Cloudflare.RateLimit`, which counts each code request against the client's IP and against the address. `serveAll(yield* signInMethods, signInFailures)` serves `requestSignInCode` and `signedInUser`; the Backend's `fetch` hands `/api/auth/*` to `Auth`'s `serve`, which answers only the code check and sign-out.
- **The admin gate.** `serveAdmin(methods, failures)` serves each method with the request's `RequestInfo` first, runs `requireAdmin` on it, and declares `UnauthorizedError` and `ForbiddenError` beside the method's own failures. The Website only redirects a signed-out visitor to sign-in.
- **Stack.** `bindSiteAuth(backend, { authOrigin, environment })` binds the Website's URL and what the environment takes. On staging and production codes are `mailed`, and each address gets `SIGN_IN_CODES_PER_DAY` (10) codes from the sign-in page per UTC day, refused past that as `TooManyRequestsError`, like the per-minute limit. Everywhere else codes are `inline` (they come back to the page) and uncapped. `seedSiteUsers(database, [{ email, role: "admin" }], { sql? })` is the only way an admin is made; `sql` is the app's own seed, run after the users in the same Action, so the app needs no second seed Action (two at once on local D1 fail with `SQLITE_BUSY`).
- **Control door.** Mount `SiteAuthControlRpcs` with `siteAuthControlHandlers`: `IssueSignInCode` answers a code in one call, never mailed and never counted against the daily cap, for a test runner on a stage that mails codes.
- **Website.** The app's `api.auth.$` route is `server: { handlers: authHandlers(env) }`. Its server function for a code is `signInCodeResult(backend().requestSignInCode(requestInfoOf(getRequest()), data))`. `SignInPage` (with an optional `footer`, such as a help link) and `SignOutButton` come from `/website/react`.
- **Tests.** `SiteAuthTest` from `/test/node` runs it all over `D1Test`. The package's browser tests click through `SignInPage` and the admin section under a router built as above, so an app tests only its own pages.

## App token keys

Each Shopify app (one `client_id`, so one per stage's toml) signs its application-only token requests with its own P-256 key. The `app-token-key` command runs inside an app with `vp exec app-token-key`. The Shopify CLI has no command for an app's public keys, so registering one stays a paste in the Dev Dashboard.

- `new --config <shopify.app[.<name>].toml> --dotenv <.env | .env.<stage>>` reads the toml's `handle`, makes a key pair and writes `SHOPIFY_APP_TOKEN_KEY` (the PKCS #8 base64 body on one line) and `SHOPIFY_APP_TOKEN_KID` into the file, replacing their old values in place and leaving every other line as it was. It creates a missing file with mode 0600. The `kid` is `<handle>-<YYYYMMDD>` (UTC), `-2`, `-3` when the file already holds that day's. It prints the public JWK alone on stdout, so `| pbcopy` copies it, and the next steps on stderr: paste it under Dev Dashboard > the app > Settings > Credentials > Public keys > Add key, store the private key in KeePassXC, and for `.env.<stage>` push it with `vp run stage up <stage>`. It never prints the private key.
- `verify --config <toml> --dotenv <file> --shop <shop>.myshopify.com` mints once with the file's key. Shopify checks the key before the installation, so any existing store answers: a token or `400 app_not_installed` means registered, `401 invalid_client` means not registered yet or a wrong `kid`, and it exits 1 on that or any other answer. It never prints the token.
- The flag is `--dotenv`, not `--env-file`: Node exits on `--env-file <file>` anywhere in its argv when the file is missing.
- Rotation: run `new` on the same file, register the new JWK beside the old (Shopify allows two keys per app), deploy, then revoke the old `kid` in the Dev Dashboard once its tokens have expired, an hour after the deploy. `new` names the old `kid` when it replaces one.

## Upgrading to 0.14

The admin page components are now route options; no page takes `children`, links or callbacks, and `PageLink`, `AdminShopsPage`, `AdminShopLayout`, `AdminShopOverviewPage`, `ShopActorObjectsPage` and `OrphanShopActorObjectsPage` are gone.

- `/admin/shop/$shop` moves to `/admin/shops/$shop`. Rename `admin.shop.$shop*.tsx` to `admin.shops.$shop*.tsx`, and change the paths in the server functions' admin redirects.
- `admin.shops.tsx` becomes `createFileRoute("/admin/shops")(adminShops)`, and the list moves to `admin.shops.index.tsx`, `adminShopsList({ load })`.
- Replace each admin route file's body with the package's options, as in [Admin pages](#admin-pages): `admin.tsx` spreads `adminLayout` beside its `beforeLoad`, and `admin.index.tsx` is `adminHome`. Delete the app's own admin home, its Sign out buttons, its `errorComponent`s and its search schemas for these pages.
- An app's own admin page adds `staticData.admin` with a `summary` to appear on the home page, and renders sections. An app's own shop tab keeps its `adminTab` and moves with the route.

## Upgrading to 0.13

- Replace the app's Shops and shop pages with the routes in [Admin pages](#admin-pages), and its admin Backend methods with `adminShopMethods(catalog)`. Each per-shop page the app keeps becomes a child route of `admin.shop.$shop.tsx` with an `adminTab`.

## Dropping the refresh columns

- `AppInstallation` loses `refreshToken` and `refreshTokenExpiresAt`, edited into `0000_sac_01_app_installation.sql`. Recopy it into the app's `migrations/` and reset each stage's database.
- `AppInstallationRedacted` drops `hasRefreshToken` and `refreshTokenExpiresAt`. `SeedInstallation` drops the refresh fields, and the `legacyRow` harness capability is gone.

## Upgrading to application-only tokens

Every Admin API token now comes from Shopify's application-only grant, signed with the app's own key. Token exchange, refresh tokens and the `ShopGrantor` Durable Object are gone.

- Give every stage's app a signing key before deploying, with the `app-token-key` command (below): in `.env` for `dev` and `e2e`, in `.env.<stage>` for each deployed stage, beside `SHOPIFY_API_SECRET`. `shopifyCliApp` and `deployedShopifyApp` read `SHOPIFY_APP_TOKEN_KEY` and `SHOPIFY_APP_TOKEN_KID`, and `bindShopifyApp` binds them. A Backend without them, or with a key that does not import, fails at startup naming the variable. `ShopifyCredentials` gains `appTokenKey` and `appTokenKid`.
- The deploy that takes this release deletes the `ShopGrantor` class, so it goes out at 100%, not as a gradual rollout. The class stored nothing.
- `ReauthenticationRequiredError` is gone from `/contract`, `ShopifyAccessFailure` and `EnsureSessionFailure`. A handler that matched it drops the branch.
- Installed shops need nothing: the next request mints and writes the row's refresh columns null.
- Tests: `ShopifyFake` installs shops explicitly (`install`, `uninstall`) and verifies each assertion against the fake app's key. `SeedInstallation` trades `recognized` for `installed`. `grantBody`, `REFRESH_GRANT`, `TOKEN_EXCHANGE_GRANT` and `FAKE_REFRESH_TOKEN_EXPIRES_IN` are gone. A test Backend's stack binds the fake app's key through `fakeShopifyApp`.

## Upgrading to 0.11

- Sign-in codes are six digits, not eight. A test that matches the code's length changes.
- Recreate the database (or apply the new `create table if not exists SignInCodeCount`), and copy the package's `0000_sac_02_better_auth.sql` into the app's `migrations/` again, which `expectMigrationsSynced` checks.
- `shopActorObjectMethods` is served behind the admin gate already, and `shopActorObjectFailures` is gone: replace `serveAdmin(yield* shopActorObjectMethods, shopActorObjectFailures)` with `yield* shopActorObjectMethods`.
- `adminLink` on `ShopActorObjectsPage` and `OrphanShopActorObjectsPage` needs `href`: `{ href: "/admin", onClick }`. A plain click still runs `onClick` alone; a click with a modifier key opens `href` in a new tab.
- The rate limit's refusal reads "Too many attempts. Try again later.", since it now also answers the daily cap.

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
