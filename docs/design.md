# About the design of shopify-app-cloudflare

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

An app supplies its config and secrets, its plan catalog, lifecycle hooks (before and after uninstall, plan changed), its tables that cascade from `AppInstallation`, its extra webhook topics and its own shop actor class. How the app's shop actor takes the package's machinery is in [The shop actor](#the-shop-actor).

The work starts with authentication, billing and webhooks, then the shop actor machinery and client, then the Website side.

## Where an app's identity and secrets live

Each stage's `shopify.app*.toml` in the app's repository is the only place its app's public identity is written: the top-level `handle` and `client_id`, which is the app's API key (`SHOPIFY_API_KEY`). The app's `alchemy.run.ts` reads them from the toml at stack time (`readAppIdentity`, `shopifyCliApp`, `deployedShopifyApp`) and binds them into the Backend; the deployed Worker never reads a file. Only secrets come from the environment: `SHOPIFY_API_SECRET` and the Partner values. Under `shopify app dev` the CLI's injected `SHOPIFY_API_KEY` must equal the toml's `client_id`, or the stack fails.

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

Apps install the package from npm, `pnpm add @mw10013/shopify-app-cloudflare`. The published tree is `dist/`, the built package: JavaScript, `.d.ts` files and source maps with their sources, so nothing builds at install time and Node never strips TypeScript under `node_modules`. `effect` and the Alchemy packages are peer dependencies, so each app loads one copy of each.

Releases before `0.5.0` were git dependencies on a release tag of this repository, under the old name `@mw10013/shopify-app-workers`. A tag push publishes through `.github/workflows/publish.yml` with npm trusted publishing, so the repository stores no npm token.

## Where the package is developed

The package is developed in `apps/testbed`, a minimal embedded app with its own Shopify app and no customers. The testbed consumes the package as a workspace package, so Vite and the Backend's rolldown watch the package's source and an edit shows up in the running app. Its dev and e2e stores come from the package's store pool (`/dev/stores`) like every other app's.

The testbed can exercise paths that product apps cannot run lightly: uninstall and reinstall, token expiry, plan changes and bad HMACs. Its staging stage proves the deploy path through Workers Builds before any app takes a release. New apps start from it.

## The shop actor

Each app has one Durable Object per shop, its shop actor. A merchant's browser holds one WebSocket to it and calls its procedures over Effect RPC. When a write lands, the actor pushes a notice naming the stale data, and every open tab reads it again. motio, bang and baton each wrote this machinery themselves, and on 2026-11-08 their copies of the socket transport differed by 23 lines in baton and 110 in bang.

The package owns what every app writes the same way:

- The socket transport. It covers who is calling, the socket a write came in on, and what happens to a request when its socket closes.
- The Backend's upgrade path. It reads the shop from the URL, runs the merchant gate, and forwards the socket to the actor. A refusal becomes a close code.
- The actor's lifecycle. It refuses a shop that is not installed, runs the app's migrations on first activation, closes every socket with `CONNECTION_CLOSE_UNINSTALLED` and deletes storage and the alarm on uninstall, and closes sockets with `CONNECTION_CLOSE_REVOKED` when the plan changes.
- Notices. A tab refreshes each key at most once every 3 seconds and holds keys while hidden. The tab that made the write gets its notice at once.
- The browser client, without React. It covers connection state, retry by close code, and notices that refresh what is on screen.

The app owns its procedures, its tables, its reactivity keys, its alarm and its pages.

### The app declares the class, the package builds its body

The app writes its own class and hands the package what differs:

```ts
export class ShopActor extends Cloudflare.DurableObject<ShopActor, ShopActorShape>()("ShopActor") {}

export const ShopActorLive = ShopActor.make(
  ShopActorKit.make({
    rpcs: MotioRpcs,
    migrations,
    build: ({ shop, sql, notify }) =>
      Effect.gen(function* () {
        const scan = yield* Scan.make({ shop, sql, notify });
        return { handlers: motioHandlers(scan), alarm: scan.tick };
      }),
  }),
);
```

The other way is a base class the app extends, overriding `handlers` and `alarm`. That way fails on two counts. Alchemy's `Cloudflare.DurableObject` builds the class from an Effect, so a base class would have to wrap Alchemy's own factory. And the grantor already composes this way, so the package would mix two styles for one kind of thing.

The class name stays `ShopActor` in every app. A Durable Object class rename or delete blocks a Workers rollback, so moving an app onto the kit must show no class created or deleted in `alchemy plan`.

### Roles

motio and bang have one role: the merchant, someone holding a Shopify ID token for the shop. baton adds members and displaces an older socket when the same member connects twice. The kit takes the role as a type parameter, with merchant as the default, and takes displacement as an optional hook. baton can then join without a breaking change. Neither motio nor bang writes anything for roles.

### Close codes are a contract

The Website and the Backend deploy separately, so for a while a browser can run a different version than the actor. The close codes are therefore fixed. A new release can add a code, but never renumbers or removes one.

| Code | Name | Browser does |
|---|---|---|
| 1013 | `TRY_AGAIN` | retries |
| 3401 | `REVOKED` | reconnects through the gate, which reads the new plan |
| 4401 | `UNAUTHENTICATED` | stops |
| 4402 | `PAYMENT_REQUIRED` | goes to plan selection |
| 4403 | `FORBIDDEN` | stops |
| 4404 | `NOT_A_MEMBER` | stops (baton only) |
| 4409 | `DISPLACED` | stops; another tab took the socket (baton only) |
| 4410 | `UNINSTALLED` | stops; the actor and its data are gone |

### Live reads go through route loaders

A page reads its data in its TanStack route loader, and a notice for one of its keys makes the router load it again. motio and baton do this (`live-route.ts`). bang reads through atom queries instead. Route loaders win because the page's first render already has its data from server rendering, and the Website side of the package (step 8, part B) is built on the router anyway.

## The Website side

The Website is each app's TanStack Start Worker: the embedded pages, the auth and webhook routes, and the browser half of the shop actor. motio and the testbed each hold their own copy of the pieces every embedded app needs. On 2026-11-09 the testbed's `shopify.ts` differed from motio's by 160 lines, `shopify-urls.ts` by 81 and `-app-guard.ts` by 89.

The package takes the pieces every app writes the same way:

- Shopify's URLs and headers. These are the embedded app URL, the ID token bounce, the exit-iframe destination, and the document headers (CSP `frame-ancestors`).
- The App Bridge page and its client calls. The page loads App Bridge; the client calls are `mintIdToken`, `toast` and `showSaveBar`.
- The merchant guard. A document request with a bearer skips the search checks; one without bounces to Shopify for an ID token; the billing return carries `plan_handle`. It is motio's `documentGuard`.
- The Backend's refusals mapped to Website answers: 401 bounces, 402 goes to plan selection, 503 shows "Shopify isn't responding".
- The live route reads. A route names its reactivity keys, a notice reloads its loader, a failed reread keeps the last answer, and a banner says so. `readLiveAnswer` reads the server once, then only the live part over the socket into the last answer. This is baton's `live-route.ts`, a superset of motio's.
- `ShopSocket`, which opens the socket after hydration, and `SocketBanner`, which shows a lost connection. The banner is baton's: it shows a displaced socket with Reconnect, and a member's 4401 is not an expiry. The app passes its name for the banner's copy.
- The cross-site check on the socket upgrade route.

The app keeps its pages, its routes and its server functions.

### Two entries: `/website` and `/website/react`

`/website` has no React and no TanStack. It holds the URLs, headers, the App Bridge page, the refusal mapping, and the guard's decision as a plain function of the request's path, search and bearer. `/website/react` holds `ShopSocket`, `SocketBanner` and the live route helpers, which take the app's router. React, `@tanstack/react-router` and `@effect/atom-react` are optional peers of the package, needed only by `/website/react`. A Website that imports only `/website` needs none of them.

### TanStack's server functions stay in the app

TanStack Start's compiler rewrites `createServerFn`, `createMiddleware` and `createIsomorphicFn` calls in the app's source. It splits each into a server half and a client stub. The package ships built JavaScript under `node_modules`. Whether the compiler rewrites calls there is not tested; the design does not depend on it. Each app keeps thin wrappers around the package's plain functions. Each wrapper is a few lines: `authenticateApp`, `getShopifyApp`, `shopifyMerchant`, `embeddedIdToken`, `documentHasBearer`. The guard takes them as inputs, which motio's `AppGuardReads` already does.

Route files stay in the app too, because TanStack's router builds its tree from the app's `routes/` directory. The package gives each route its handler, and the app's file is two lines: `auth.session-token`, `auth.exit-iframe`, `webhooks.$` and `api.actor.$key`.

## Production rules

These rules hold for every release, because each app's production upgrades on its own schedule and must be able to roll back:

- Migrations are forward only and expand before they contract. A Workers rollback does not revert D1, so the previous app version must still work against the new schema. A release removes a column only after every app's production runs a release that no longer reads it.
- The grantor's and the shop actor's Durable Object class names never change. A Durable Object class change blocks a Workers rollback.
- During a gradual deploy only one version of a Durable Object runs, so the grantor accepts calls from the old and the new Worker version.
- The package pins the Admin API version, and a check holds each app's `[webhooks] api_version` equal to it.

## Decisions

- A failed webhook HMAC logs at `Error`. A wrong API secret makes every real delivery fail, including `app/uninstalled`, and nothing else reports it. If scanner noise gets expensive, the fix is sampling, not a lower level.
- Plan handles are an allowlist in every app.
