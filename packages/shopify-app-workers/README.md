# @mw10013/shopify-app-workers

The shared foundation for embedded Shopify admin apps that run on Cloudflare Workers with Effect, TanStack Start and Alchemy. An app supplies its config, secrets, plan catalog, hooks, tables and shop actor; the package supplies the rest.

Install a release by its tag, which needs no registry and no token:

```json
"@mw10013/shopify-app-workers": "github:mw10013/shopify-app-workers#v<x.y.z>"
```

The subpath exports are `/backend`, `/contract`, `/stack`, `/website`, `/client`, `/test`, `/test/node` and `/test/e2e`. An app copies `migrations/` into its own D1 migrations and starts from a fresh database: the migrations create the `AppInstallation` table but do not reconcile one an app already has.

A release commit holds build output only. The source and its design live in https://github.com/mw10013/shopify-app-workers, under `packages/shopify-app-workers`, at the commit the release commit's `Source:` line names.
