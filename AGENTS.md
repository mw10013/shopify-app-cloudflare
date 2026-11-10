# AGENTS.md

Use the coder skill.

## Project
shopify-app-cloudflare: the shared package for embedded Shopify admin apps on Cloudflare Workers with Effect, TanStack Start and Alchemy.
`apps/testbed` is the unreleased Shopify app the package is developed and end-to-end tested in.
The package is published to npm as `@mw10013/shopify-app-cloudflare`. It owns the Shopify dev tooling (`/dev/*`) on top of `@mw10013/rigging`, which stays Shopify-agnostic.

## Checks
`vp check` at the root. The suites run in their own directories, because the integ suite reads `./migrations` from the working directory: `vp test run` in `packages/shopify-app-cloudflare`, then `vp test run --project unit` and `--project integ` in `apps/testbed`. `vp run build` in the package writes `dist/`, the tree `npm publish ./dist` ships; `vp run consumer-check` installs its packed tarball in a fresh project.

## Releasing
The version lives in `packages/shopify-app-cloudflare/package.json`. Bump it in a PR; after it merges, the agent pushes the tag `v<version>` from `main`, and `.github/workflows/publish.yml` publishes to npm. 

