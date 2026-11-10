# shopify-app-cloudflare

The shared foundation for embedded Shopify admin apps that run on Cloudflare Workers with Effect, TanStack Start and Alchemy.

Each app installs one package, `@mw10013/shopify-app-cloudflare`, and supplies only what is its own: config, secrets, its plan catalog, hooks, its own tables and its own shop actor. Everything the apps have in common lives here once, so the apps cannot drift apart.

The repository holds two things:

- `packages/shopify-app-cloudflare`: the package, with subpath exports `/backend`, `/website`, `/client`, `/test` and the Shopify dev tooling under `/dev/*`.
- `apps/testbed`: a Shopify app that is never released. The package is developed and end-to-end tested in it against a real Shopify admin before any app takes a new version.

An app installs the package from npm:

```sh
pnpm add @mw10013/shopify-app-cloudflare
```

The Shopify dev tooling lives here too, as `/dev/*`: the berth client, the dev and e2e servers, the agent Chrome, the embedded app helpers and the stage store. It builds on [`@mw10013/rigging`](https://www.npmjs.com/package/@mw10013/rigging), which stays Shopify-agnostic. The workspace catalog pins rigging once (`pnpm-workspace.yaml`), and the root and `apps/testbed` depend on it as `catalog:`.

An app moving off `@mw10013/devkit` runs `vpx <this checkout>/packages/shopify-app-cloudflare/scripts/migrate-from-devkit.ts` in its root. It rewrites `@mw10013/devkit/shopify/<m>` to `@mw10013/shopify-app-cloudflare/dev/<m>`, `@mw10013/devkit/<core|cloudflare>/<m>` to `@mw10013/rigging/...`, the `devkit-*` and `bosun` scripts to `rigging`, and `BOSUN_ENDPOINT` to `RIGGING_ENDPOINT`. The dependency lines and prose stay for the person migrating.

A pushed tag `v<version>` publishes the package to npm (`.github/workflows/publish.yml`). The version lives in `packages/shopify-app-cloudflare/package.json`, and the tag must match it. To release, bump that version in a PR, merge it, then push the tag from `main`. The first version predates trusted publishing, which npm configures only for a package that exists: the owner publishes it once by hand (`vp run build`, then `npm publish ./dist` in `packages/shopify-app-cloudflare`), then adds this workflow as the trusted publisher in the package's npm settings.

[Design](docs/design.md) explains the decisions and the production rules. [Roadmap](docs/roadmap.md) lists the work in order.
