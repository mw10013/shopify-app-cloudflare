# Roadmap

Each step ends in a check, and the next step starts only after it passes.

## Before the first step

The testbed needs two Shopify apps. Each is created once with `shopify app config link`, run by the owner in an interactive terminal in `apps/testbed`, choosing to create a new app. The CLI writes the new app's `client_id` into the TOML in the same run; commit the file at once, because an app whose client ID is not saved is effectively lost, along with its handle. Creation sends no handle, so `shopify app deploy` sets it afterwards from the TOML. If Shopify rejects a handle as taken, choose another; nothing is lost.

| Environments | Config file | App name | Handle |
|---|---|---|---|
| `dev` and `e2e` | `shopify.app.toml` | Workers Testbed Dev | `workers-testbed-dev` |
| `staging` | `shopify.app.staging.toml` | Workers Testbed Staging | `workers-testbed-staging` |

A production stage, to rehearse production deploys and migrations without customers, is decided after staging works.

## Steps

1. Scaffold the repository: the pnpm workspace, Vite+, `packages/shopify-app-workers` and `apps/testbed` with its `shopify.app.toml`. Check: `vp check` passes and the testbed opens in a pool store's admin.
2. Move authentication, billing and webhooks into the package, starting from baton's code with the drift resolved. Check: the unit and integ suites pass against the Shopify fakes, and an edit to the package shows up in the running testbed.

   The live-edit check, run on 2026-11-08 in `apps/testbed`:

   1. `vp run dev`, then confirm in `vp run dev:logs` that Alchemy created `Database` and the Backend; both migrations are in the local D1's `__alchemy_migrations`.
   2. Deliver a test webhook for a topic nobody handles, through the tunnel and so through the Website's `/webhooks/*` forward. It only sends a test delivery, signed with the app's secret:

      ```sh
      url=$(bosun status dev | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])')
      shopify app webhook trigger --no-input --config shopify.app.toml --topic products/create \
        --api-version 2026-10 --delivery-method http --address "$url/webhooks/products/create"
      ```

      `vp run dev:logs` shows `Webhooks.handle: shop=shop.myshopify.com topic=products/create: no handler`.
   3. Edit that message in `packages/shopify-app-workers/src/internal/webhooks.ts`. The log shows `[Backend] Rebuilding`, then `[Backend] Updated`.
   4. Deliver again; the log shows the edited message.
   5. Revert the edit, then `vp run dev:stop`.

   The receipt line (`Webhooks.handle: shop=… topic=…`) is Debug, which the dev stage does not print, so the check uses the unknown-topic line, an Error. A delivery of `shop/update` logs `Testbed.shopUpdate: shop=… status=received`.

   The suites against the Shopify fakes, run on 2026-11-08; both halves of the check have passed:

   ```sh
   vp check                                        # at the root
   vp -C packages/shopify-app-workers test run     # the package's unit suite
   vp -C apps/testbed run test:unit                # the testbed's unit suite, in process
   vp -C apps/testbed run test:integ               # the testbed's integ suite, in workerd
   ```

   Results: the package's unit suite 219 passed; the testbed's unit suite 95 passed; the integ suite 88 passed and 5 skipped, the cases that need `clock` (4: 12×2, N15, N18) or `holdWrite` (1).

   The integ suite deploys `test/integ/stack.ts` locally: a test Backend that is the production body and tier 1 with `ShopifyTestDoor` in front, and a test Website bound to it. Every required behavior runs inside the test Backend against the real `ShopGrantor` Durable Object and the real D1; the cases that need the test clock or a held store write run only in process. Binding-level cases call `authenticateMerchant` over `BACKEND`, deliver signed webhooks through the Website's `/webhooks/*` forward, and trigger the daily cron through workerd's `/cdn-cgi/handler/scheduled`.
3. Run the end-to-end suite in the testbed against real Shopify, including uninstall and reinstall. Check: the suite passes.

   The suite, run on 2026-11-08 in `apps/testbed`; the check has passed:

   ```sh
   vp run e2e:start    # leases a pool store, starts the e2e server and its tunnel
   vp run test:e2e     # the package's e2e spec pack, on the agent Chrome
   vp run e2e:stop
   ```

   Results: 4 passed in 2.3 min, then 4 passed in 2.1 min on a second run in a row, on `mw10013-pool-15`. Before them, the package's unit suite 239 passed, the testbed's unit suite 125 passed, and the integ suite 98 passed and 5 skipped, the same in-process-only cases as step 2.

   The pack is `@mw10013/shopify-app-workers/test/e2e`; an app supplies an `E2eApp` and registers `e2eProjects(app, root)`. It runs on one worker, because every spec shares the leased store, in three projects, each after the one before:

   1. `shopify admin auth` exports the agent Chrome's Shopify login on every run. A lapsed login fails here; sign in to the agent Chrome and run again.
   2. The lifecycle spec installs the app, picks Testbed Basic, switches to Testbed Pro, uninstalls from the admin and waits for the e2e status route to show the installation gone, then reinstalls and picks Testbed Basic again. It is a project of its own because uninstalling ends the CLI's dev preview, so the spec restarts the server (`vpx scripts/e2e.ts reinstall`).
   3. The other specs:
      - The smoke opens App Home in the leased store's admin and checks the shop and plan it shows against the e2e status route.
      - The webhooks spec sends `shop/update`, `customers/data_request`, `customers/redact` and `shop/redact` with `shopify app webhook trigger` through the tunnel. The CLI only says a remote delivery was enqueued, so the e2e Backend records each answer it gives, and the spec requires exactly one delivery per trigger, matched by a marker in the address, answered 200: the HMAC passed and the topic reached its handler. The bad-signature case is in the integ suite (N26).

   What real Shopify showed, which the fakes did not:

   - Uninstalling ends the CLI's dev preview, so App Home stops loading from the tunnel until `app dev` runs again.
   - A cancelled subscription survives uninstall until its period ends.
   - The CLI sends `app/uninstalled` on a checkout's first `app dev`, so `e2e:start` waits for that delivery before it reports ready.

   Every click, wait and failure snapshot checks first that the page is on the checkout's leased store, because the agent Chrome holds other agents' tabs. Traces are off; `E2E_TRACE=1` turns them on with a warning, since each holds a live admin login.
4. Cut `v0.1.0` as a tag on a commit that holds only the built package. Check: a throwaway project installs it with `--frozen-lockfile` and no token.

   Cut on 2026-11-08 from `main` at `a80fc9e`; the check has passed:

   ```sh
   vp run release 0.1.0 --dry-run    # at the root: verify, build, the release commit; no tag
   vp run release 0.1.0              # the same, then tags v0.1.0 and pushes the tag
   vp -C packages/shopify-app-workers run consumer-check github:mw10013/shopify-app-workers#v0.1.0
   ```

   An app pins `"@mw10013/shopify-app-workers": "github:mw10013/shopify-app-workers#v0.1.0"`. The tag is commit `be5b72a`, tree `a8f271e`, with no parent: 120 files, `package.json`, `LICENSE`, `README.md`, 115 under `dist/` and the 2 migrations. The release runs on devkit's `core/release` (devkit 0.1.3), which refuses a dirty checkout or one off `origin/main`, before and after verify and build, and never moves a tag. Verify is `vp check`, the package suite and the testbed's unit and integ suites; e2e is not in it, because it needs a leased store and a login.

   The built manifest maps each export to `dist/<entry>.mjs` and `.d.mts`, ships `files: ["dist", "migrations"]`, and drops `private`, `imports`, `scripts` and `devDependencies`. The source manifest is `0.0.0-source` and `private`, so only a release can publish it. There are no source maps, because they would point at `src/`, which the tag does not hold.

   `consumer-check` builds a project in a temp directory with an empty `HOME`, `GIT_CONFIG_GLOBAL=/dev/null` and no tokens, and all 8 steps passed against the tag:

   1. the spec;
   2. the project's `package.json`;
   3. `pnpm install` pins the codeload tarball in the lockfile;
   4. `pnpm install --frozen-lockfile` into a cold store;
   5. strict `tsc --noEmit` over all 8 entries, with `skipLibCheck` off. It ignores the 351 errors located in other packages' declarations, mostly `@cloudflare/workers-types` against the DOM lib, and fails on any in the package's own;
   6. all 8 entries import in Node;
   7. a Worker importing `./backend` and `./website`, bundled with Alchemy's rolldown plugin, answers 200 in Miniflare;
   8. `playwright test --list` collects the pack's 4 specs from `node_modules`.

   With no spec, `consumer-check` packs this checkout's release tree and checks that instead.

   The testbed stays on `workspace:*`, so an edit to the package still shows up in the running testbed; motio, in step 7, is the first app on the tag.
5. Deploy the testbed's staging through Workers Builds. Check: the build installs and deploys, and the staging app works in a pool store.

   The staging deploy reads the app's handle and client ID from `shopify.app.staging.toml`, so the deploy environment carries only secrets: `SHOPIFY_API_SECRET` and the Partner values.

   Set up and checked on 2026-11-08; the check has passed. The stage follows coder's `references/deployed-stages.md`:

   - The app is Workers Testbed Staging, handle `workers-testbed-staging`, client ID `2ff26a6bbebd01510b646e756fa841bf`, made by the owner with `shopify app config link -c staging`. Its toml copies the dev toml's scopes and webhooks, points at `https://testbed-website-staging.mw10013.workers.dev`, and `test/unit/app-tomls.test.ts` fails when the two drift. Its managed plans `testbed-basic` and `testbed-pro` were made by hand, as on the dev app.
   - Workers Builds deploys on every push to `main`: `pnpm exec vp run deploy:staging` at the root, which is `alchemy deploy --stage staging --yes` in `apps/testbed`. Builds does not run `shopify app deploy`; the owner runs `shopify app deploy --config staging` in `apps/testbed` when the staging toml changes, as baton and motio do. Shopify had the toml's config before the first deploy.
   - The trigger's variables are `apps/testbed/.env.staging`, declared in `stacks/stage-env.ts`: `SHOPIFY_API_SECRET` and the three Partner values. `vp run stage up staging` in `apps/testbed` made the trigger, set them and ran the first build; it is rerun whenever a value changes.
   - The staging app is installed on `mw10013-pool-17`, leased with `berth acquire staging`, which keeps it out of dev and e2e rotation.

   The check, in `apps/testbed`:

   ```sh
   vp run stage check staging     # plan succeeds; build 4d40cbf7, from the merge of #36, succeeded; the trigger holds every field
   vp run logs show staging --since "10 minutes"
   shopify app webhook trigger --no-input --config shopify.app.staging.toml --topic shop/update \
     --api-version 2026-10 --delivery-method http \
     --address https://testbed-website-staging.mw10013.workers.dev/webhooks/shop/update
   ```

   Results:
   - The install on `mw10013-pool-17` exchanged the session token, sent the shop to plan selection, and after Testbed Basic, App Home loaded from the staging Worker showing the shop, `testbed-basic` and the install time.
   - `shop/update` logged `Testbed.shopUpdate: shop=shop.myshopify.com status=received` and answered 200. `customers/data_request`, `customers/redact` and `shop/redact`, sent the same way to `/webhooks/compliance`, each answered 200 at the Backend and the Website. So Shopify's signatures validate against the staging secret.

   The e2e pack does not run against staging: it needs the dev tunnel and the e2e-only status route, which the production Backend does not serve.
6. Rehearse a migration: add a column, deploy, roll back. Check: the previous version still works against the new schema.

   Skipped on 2026-11-08 by the owner's decision. Migrations stay additive, as coder's `references/deployed-stages.md` requires, so a Worker rolled back over one still runs. The first migration a Workers Build applies, and the first rollback, will be real ones.
7. Move motio onto the package as its first real consumer. Check: motio's suites and the shared e2e spec pack pass.

   Done on 2026-11-08; the check has passed. Motio is on `v0.1.1` (motio #75, #76):

   - Its Backend uses the package's grantor, client, billing, webhooks and `AppInstallation` store; its copies are deleted. `AppInstallation` was the only table in motio's `0001_init.sql`, so that file is gone and the package's migrations replace it. Staging was reset from scratch rather than migrated (`vp run stage reset staging --confirm staging`); production is not yet reset.
   - It runs the shared e2e pack. App Home holds the shop and plan handle as hidden elements the pack reads; merchants see neither.
   - Checked on `mw10013-staging-shop-00` after the reset: App Home loads and a scan runs.
8. Extract the shop actor machinery and client, then the Website side, each through the same steps.
