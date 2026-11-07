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
3. Run the end-to-end suite in the testbed against real Shopify, including uninstall and reinstall. Check: the suite passes.
4. Cut `v0.1.0` as a tag on a commit that holds only the built package. Check: a throwaway project installs it with `--frozen-lockfile` and no token.
5. Deploy the testbed's staging through Workers Builds. Check: the build installs and deploys, and the staging app works in a pool store.
6. Rehearse a migration: add a column, deploy, roll back. Check: the previous version still works against the new schema.
7. Move motio onto the package as its first real consumer. Check: motio's suites and the shared e2e spec pack pass.
8. Extract the shop actor machinery and client, then the Website side, each through the same steps.
