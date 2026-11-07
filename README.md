# shopify-app-workers

The shared foundation for embedded Shopify admin apps that run on Cloudflare Workers with Effect, TanStack Start and Alchemy.

Each app installs one package, `@mw10013/shopify-app-workers`, and supplies only what is its own: config, secrets, its plan catalog, hooks, its own tables and its own shop actor. Everything the apps have in common lives here once, so the apps cannot drift apart.

The repository holds two things:

- `packages/shopify-app-workers`: the package, with subpath exports `/backend`, `/website`, `/client` and `/test`.
- `apps/testbed`: a Shopify app that is never released. The package is developed and end-to-end tested in it against a real Shopify admin before any app takes a new version.

The dev tooling comes from `@mw10013/devkit`, a release tag of the public `mw10013/tools`. The workspace catalog pins it once (`pnpm-workspace.yaml`), the root and `apps/testbed` depend on it as `catalog:`, and nothing is vendored. `devkit upgrade` moves the pin and `vp run check:pin` fails on a `file:`, `link:` or prerelease spec, which a trial build may use on a branch that is never merged.

[Design](docs/design.md) explains the decisions and the production rules. [Roadmap](docs/roadmap.md) lists the work in order.
