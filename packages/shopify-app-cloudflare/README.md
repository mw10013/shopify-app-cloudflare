# @mw10013/shopify-app-cloudflare

The shared foundation for embedded Shopify admin apps that run on Cloudflare Workers with Effect, TanStack Start and Alchemy. An app supplies its config, secrets, plan catalog, hooks, tables and shop actor; the package supplies the rest.

```sh
pnpm add @mw10013/shopify-app-cloudflare
```

The subpath exports are `/backend`, `/contract`, `/stack`, `/website`, `/website/react`, `/client`, `/test`, `/test/node`, `/test/e2e`, `/test/e2e/backend`, `/test/e2e/server` and `/test/e2e/config`. The Shopify dev tooling is `/dev/agent-chrome`, `/dev/app-handle`, `/dev/berth`, `/dev/embedded-app`, `/dev/local-route`, `/dev/server`, `/dev/stage-store`, `/dev/web` and `/dev/worktree`. The `/dev/*` modules and the e2e pack need the optional peers `@mw10013/rigging` (0.4 or later), `playwright` and `@effect/platform-node`; the servers run under the app's own `rigging server`. An app copies `migrations/` into its own D1 migrations and starts from a fresh database: the migrations create the `AppInstallation` table but do not reconcile one an app already has.

## Upgrading from 0.5

0.6 removes `runningServerSync` from `/dev/server` and changes `routeAppToLocal` in `/dev/local-route`. Update every caller, scripts included, not only `playwright.config.ts`:

- `runningServerSync(environment, app)` becomes `runningServer(environment, root)` from `@mw10013/rigging/core/test`. It takes the app root as a string, and returns `{ port, url, localURL }`, where `url` is a `string | null`, not an `Option`. It throws when the server is not running.
- `routeAppToLocal(context, server)` takes `{ port, tunnel }`. In a Playwright config that is `app.server` from `shopifyE2eConfig`. Elsewhere it is `{ port, tunnel: url }` from `runningServer`, once you have checked that `url` is not null.

## Testing

An app's Vitest projects are rigging's presets (`@mw10013/rigging/core/test`, `/core/browser-test` and `/cloudflare/test`). Its Playwright config is `shopifyE2eConfig` from `/test/e2e/config`: rigging's `e2eConfig` with the app read from its e2e lease, its running e2e server and its tomls, the spec pack's projects and preflight, one worker, and traces off unless `E2E_TRACE=1`. The app supplies what only it knows, spreads the config and appends its own projects:

```ts
// playwright.config.ts
import { app } from "@mw10013/rigging/core/app";
import { appBaseUrl, e2eProject } from "@mw10013/shopify-app-cloudflare/test/e2e";
import { shopifyE2eConfig } from "@mw10013/shopify-app-cloudflare/test/e2e/config";
import { defineConfig } from "playwright/test";

const { root } = app(import.meta.dirname);
const { app: myApp, config } = shopifyE2eConfig({
  root,
  plans: [
    { handle: "my-app-basic", name: "Basic" },
    { handle: "my-app-pro", name: "Pro" },
  ],
  restart: ["vpx", "--env-file=.env", "scripts/e2e.ts", "reinstall"],
});

export default defineConfig({
  ...config,
  projects: [
    ...config.projects,
    e2eProject(myApp, root, {
      name: "embedded",
      testDir: "test/e2e/embedded",
      testMatch: "**/*.spec.ts",
      use: { channel: "chrome", baseURL: `${appBaseUrl(myApp)}/app` },
    }),
  ],
});
```

The source and its design live in https://github.com/mw10013/shopify-app-cloudflare, under `packages/shopify-app-cloudflare`.
