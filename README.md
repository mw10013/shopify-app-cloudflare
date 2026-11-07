# shopify-app-workers

The shared foundation for embedded Shopify admin apps that run on Cloudflare Workers with Effect, TanStack Start and Alchemy.

Each app installs one package, `@mw10013/shopify-app-workers`, and supplies only what is its own: config, secrets, its plan catalog, hooks, its own tables and its own shop actor. Everything the apps have in common lives here once, so the apps cannot drift apart.

The repository holds two things:

- `packages/shopify-app-workers`: the package, with subpath exports `/backend`, `/website`, `/client` and `/test`.
- `apps/reference`: a Shopify app that is never released. The package is developed and end-to-end tested in it against a real Shopify admin before any app takes a new version.

[Design](docs/design.md) explains the decisions and the production rules. [Roadmap](docs/roadmap.md) lists the work in order.
