# Roadmap

Each step ends in a check, and the next step starts only after it passes.

## Before the first step

The owner creates two apps in the Shopify Dev Dashboard for the reference app:

| Stage | App name | Handle |
|---|---|---|
| Local development and e2e | Workers Reference Dev | `workers-reference-local` |
| Staging | Workers Reference Staging | `workers-reference-staging` |

A production stage, to rehearse production deploys and migrations without customers, is decided after staging works.

## Steps

1. Scaffold the repository: the pnpm workspace, Vite+, `packages/shopify-app-workers` and `apps/reference` with its `shopify.app.toml`. Check: `vp check` passes and the reference app opens in a pool store's admin.
2. Move authentication, billing and webhooks into the package, starting from baton's code with the drift resolved. Check: the unit and integ suites pass against the Shopify fakes, and an edit to the package shows up in the running reference app.
3. Run the end-to-end suite in the reference app against real Shopify, including uninstall and reinstall. Check: the suite passes.
4. Cut `v0.1.0` as a tag on a commit that holds only the built package. Check: a throwaway project installs it with `--frozen-lockfile` and no token.
5. Deploy the reference app's staging through Workers Builds. Check: the build installs and deploys, and the staging app works in a pool store.
6. Rehearse a migration: add a column, deploy, roll back. Check: the previous version still works against the new schema.
7. Move motio onto the package as its first real consumer. Check: motio's suites and the shared e2e spec pack pass.
8. Extract the shop actor machinery and client, then the Website side, each through the same steps.
