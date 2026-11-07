# About the design of shopify-app-workers

baton, bang and motio are embedded Shopify admin apps built the same way. Each one had its own copy of Shopify admin authentication, written by hand from a spec in the coder skill. The copies drifted: on 2026-11-07, `shop-grantor.ts` differed from baton's by 4 lines in motio and by 471 lines in bang, and only bang and baton tested token refresh end to end. A spec cannot keep three implementations the same. One implementation can.

## What the package covers

The package holds everything an embedded app on this stack needs and no app should write itself:

- Authentication: ID tokens, token exchange and refresh through the grantor Durable Object, the `AppInstallation` table and repository, and `adminGraphql`.
- Billing: the plan cache, `SubscriptionPlan` and the merchant gate. Plan handles are an allowlist; an app passes its catalog as data.
- Webhooks: `app/uninstalled`, `app/scopes_update`, the compliance topics and the HMAC check.
- The shop actor's machinery: the socket session, notices, the activation guard and destroy on uninstall.
- The client: the Effect RPC and atom runtime over the shop actor's WebSocket.
- The Website side: App Bridge, `shopifyMerchant` and its refusals, hydration and Polaris quirks.
- Test support: the Shopify fakes, the required-behavior suites and an end-to-end spec pack that each app runs in its own wiring.

An app supplies its config and secrets, its plan catalog, lifecycle hooks (before and after uninstall, plan changed), its tables that cascade from `AppInstallation`, its extra webhook topics and its own shop actor class. Whether the app's shop actor composes layers from the package or extends a class from it is still open; it gets a design pass with competing sketches when that layer is extracted.

The work starts with authentication, billing and webhooks, then the shop actor machinery and client, then the Website side.

## Why a library inside each Worker

The package runs inside each app's Backend Worker. A separate authentication Worker that every app calls was ruled out:

- Each app has its own API key and secret for each stage. One Worker would hold every app's secrets.
- baton's tables cascade from `AppInstallation` by foreign key, and a foreign key cannot cross D1 databases.
- `adminGraphql` takes an Effect Schema to decode the answer, and a Schema cannot cross RPC.
- Alchemy's RPC drops typed errors.

## Why separate repositories and a versioned package

The apps stay in their own repositories and take versions of the package. A monorepo was ruled out for two reasons. The apps release to production on their own schedules, so production runs different versions of shared code even in a monorepo, only hidden in commit hashes. And a monorepo of ten apps at different stages couples every dependency upgrade and every end-to-end run to all ten.

So version skew between apps is expected. It stays visible as a table of app, stage and package version, and it stays bounded: Shopify supports each Admin API version for at least 12 months, the package pins one version, and every live app takes a bump at least once a year.

## How apps install it

Apps install the package as a git dependency on a release tag of this public repository, for example `"@mw10013/shopify-app-workers": "github:mw10013/shopify-app-workers#v0.1.0"`. pnpm resolves the tag to a commit and records the commit's tarball URL and SHA-512 hash in the lockfile, so every install gets the same bytes and needs no token. This was measured with pnpm 12.9.1 against a public repository.

A release tag points at a commit that holds only the built package: JavaScript, `.d.ts` files and source maps with their sources. Nothing builds at install time. pnpm blocks a git dependency's `prepare` script by default, and Node does not strip TypeScript types under `node_modules`. `effect` and the Alchemy packages are peer dependencies, so each app loads one copy of each.

npm was the alternative. A public npm package is free too, but it adds an account, 2FA, trusted-publisher setup and npm's publishing rules for no gain over a tag.

## Where the package is developed

The package is developed in `apps/reference`, a minimal embedded app with its own Shopify app and no customers. The reference app consumes the package as a workspace package, so Vite and the Backend's rolldown watch the package's source and an edit shows up in the running app. Stores come from the berth pool like every other app's.

The reference app can exercise paths that product apps cannot run lightly: uninstall and reinstall, token expiry, plan changes and bad HMACs. Its staging stage proves the deploy path through Workers Builds before any app takes a release. New apps start from it.

## Production rules

These rules hold for every release, because each app's production upgrades on its own schedule and must be able to roll back:

- Migrations are forward only and expand before they contract. A Workers rollback does not revert D1, so the previous app version must still work against the new schema. A release removes a column only after every app's production runs a release that no longer reads it.
- The grantor Durable Object's class name never changes. A Durable Object class change blocks a Workers rollback.
- During a gradual deploy only one version of a Durable Object runs, so the grantor accepts calls from the old and the new Worker version.
- The package pins the Admin API version, and a check holds each app's `[webhooks] api_version` equal to it.

## Decisions

- A failed webhook HMAC logs at `Error`. A wrong API secret makes every real delivery fail, including `app/uninstalled`, and nothing else reports it. If scanner noise gets expensive, the fix is sampling, not a lower level.
- Plan handles are an allowlist in every app.
