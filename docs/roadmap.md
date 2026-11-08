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
3. Run the end-to-end suite in the testbed against real Shopify, including uninstall and reinstall. Check: the suite passes.
4. Cut `v0.1.0` as a tag on a commit that holds only the built package. Check: a throwaway project installs it with `--frozen-lockfile` and no token.
5. Deploy the testbed's staging through Workers Builds. Check: the build installs and deploys, and the staging app works in a pool store.

   The staging deploy reads the app's handle and client ID from `shopify.app.staging.toml`, so the deploy environment carries only secrets: `SHOPIFY_API_SECRET` and the Partner values. Until that file exists, a staging deploy fails on the missing toml. The pipeline should run `shopify app deploy` from the same checkout, so the toml and Shopify stay in step.
6. Rehearse a migration: add a column, deploy, roll back. Check: the previous version still works against the new schema.
7. Move motio onto the package as its first real consumer. Check: motio's suites and the shared e2e spec pack pass.
8. Extract the shop actor machinery and client, then the Website side, each through the same steps.
