# @mw10013/shopify-app-workers

The shared foundation for embedded Shopify admin apps that run on Cloudflare Workers with Effect, TanStack Start and Alchemy. An app supplies its config, secrets, plan catalog, hooks, tables and shop actor; the package supplies the rest.

```sh
pnpm add @mw10013/shopify-app-workers
```

The subpath exports are `/backend`, `/contract`, `/stack`, `/website`, `/website/react`, `/client`, `/test`, `/test/node`, `/test/e2e`, `/test/e2e/backend` and `/test/e2e/server`. The Shopify dev tooling is `/dev/agent-chrome`, `/dev/app-handle`, `/dev/berth`, `/dev/embedded-app`, `/dev/local-route`, `/dev/server`, `/dev/stage-store`, `/dev/web` and `/dev/worktree`. The `/dev/*` modules and the e2e pack need the optional peers `@mw10013/rigging`, `playwright` and `@effect/platform-node`; the servers run under the app's own `rigging server`. An app copies `migrations/` into its own D1 migrations and starts from a fresh database: the migrations create the `AppInstallation` table but do not reconcile one an app already has.

The source and its design live in https://github.com/mw10013/shopify-app-workers, under `packages/shopify-app-workers`.
