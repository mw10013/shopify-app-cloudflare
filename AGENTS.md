# AGENTS.md

Use the coder skill.

## Project
shopify-app-workers: the shared package for embedded Shopify admin apps on Cloudflare Workers with Effect, TanStack Start and Alchemy.
`apps/testbed` is the unreleased Shopify app the package is developed and end-to-end tested in.

## Staging
The testbed's staging follows coder's `references/deployed-stages.md`; run its commands in `apps/testbed`. A push to `main` deploys it. When `shopify.app.staging.toml` changes, the owner runs `shopify app deploy --config staging`; agents never do. Logs: `vp run logs show staging --since "10 minutes"`. Its store is the `berth acquire staging` lease, `mw10013-pool-17`.
