---
name: verify-shop-lifecycle
description: "Model-check one shop's install and uninstall across Shopify, its AppInstallation row and its ShopActor Durable Object (TLA+). Use when a change touches the app/uninstalled webhook (webhooks.ts appUninstalled), ShopActors destroy or revoke, the ShopActorKit activation guard or destroy, authenticateMerchant's find/mint/insert, the socket gate (merchantGate, merchantStanding), plan revalidation's revoke, or AppInstallationStore insert/delete, and before claiming such a change cannot leave an uninstalled shop's data behind or erase a reinstalled shop's data."
---

# Verify the shop lifecycle

A TLA+ model, `verification/shop-lifecycle/ShopLifecycle.tla`, checks every interleaving of installs, uninstalls, `app/uninstalled` deliveries (duplicated, failing and redelivered), merchant page loads and sockets, the plan revalidation's revoke, object evictions and failed destroys for one shop. Tests reach only the orders someone wrote down. This model reaches all of them, inside the bounds below.

## The rules

- **StorageOnlyWithRow** (holds). Once nothing is in flight, the `ShopActor` holds storage only for a shop with an `AppInstallation` row. Harm if broken: an uninstalled shop's data stays in an object nothing accounts for, billed until the orphan sweep finds it.
- **UninstallErasesShop** (known finding, breaks today). Once nothing is in flight and Shopify says the app is uninstalled, the shop has no row and no actor storage. Harm if broken: the app keeps an uninstalled shop's row and access token, and plan revalidation keeps calling Shopify for it and recreates its actor.
- **NoStaleErase** (known finding, breaks today). An `app/uninstalled` delivery never erases the row or the actor data of an installation that came after the uninstall it reports. Harm if broken: a merchant who reinstalled loses their data, and their open app shows "uninstalled" (close code 4410) while the app is installed.

### Known findings

Both are in the code at the sync commit below. The check expects them to break. Do not weaken them; fix the code, then move the rule into `ShopLifecycle.cfg`.

**UninstallErasesShop.** A first page load inserts the row after the uninstall webhook has already deleted it:

1. A merchant opens the app on a shop with no row (a new install or a reinstall). `authenticateMerchant` finds no row, mints a token and runs `fetchShopGid`, both while Shopify still has the app installed.
2. The merchant uninstalls. `appUninstalled` deletes the row (there is none yet) and `ShopActors.destroy` succeeds.
3. The page load's `installations.insert` now writes the row. The webhook will not come again.

The row and its revoked token stay for an uninstalled shop. The window is one D1 round trip after `fetchShopGid` answers, so it is rare. The comment `No fence: … a mint never inserts` in `appUninstalled` assumes the insert cannot follow the uninstall, and this run shows that it can.

**NoStaleErase.** A late delivery erases the reinstalled shop:

1. The merchant uninstalls. Shopify queues `app/uninstalled`.
2. The merchant reinstalls before that delivery is handled, or Shopify sends the delivery again later (a duplicate, or a retry after a 500 or a slow answer).
3. The merchant uses the app. Their socket's procedures write to the actor.
4. The stale delivery runs `appUninstalled`: it deletes the row and `destroy` wipes the actor and closes the merchant's socket with 4410.

Nothing in `appUninstalled` compares the delivery with the installation it would erase. `AppInstallation.installedAt` exists for that comparison, but nothing reads it there.

## Run it

```sh
vp run verify:shop-lifecycle
```

It runs `verification/shop-lifecycle/check.sh`, which calls `verification/tlc.sh`, which runs TLC with the Java and tla2tools that the root `mise.toml` pins. The first run installs them through mise and needs the network. It takes about 25 seconds and runs three configs:

- `ShopLifecycle.cfg`, the guarantee: `TypeOK` and `StorageOnlyWithRow` must hold (about 4.98M distinct states).
- `UninstallErasesShop.cfg` and `NoStaleErase.cfg`, the known findings: each must still be violated.

The script exits 0 only when the guarantee holds and both findings still reproduce. When a finding stops reproducing, the script fails and tells you to promote the rule. Set `OUT=<dir>` to keep TLC's output (`guarantee.out`, `<Rule>.out`, each with its counterexample). To run one config by hand: `verification/tlc.sh verification/shop-lifecycle/ShopLifecycle.tla verification/shop-lifecycle/NoStaleErase.cfg`.

Read every result, pass or fail, with the pstack `/statechart` skill. On a violation it shows the shortest path to the broken rule in plain words. On a pass it draws how the system moves between states. Give it the spec and the config you ran, with the constants made smaller if the chart is too large.

## Bounds and assumptions

- One shop. It starts installed, with its row and a migrated actor.
- `MaxUninstalls = 2`, with a reinstall possible between them. `MaxDuplicates = 1` extra delivery from Shopify, `MaxFailures = 1` failed destroy (which redelivers), `PlanRuns = 2` revalidation passes. Two merchant requests (`m1`, `m2`), each one page load and then its socket. Two Worker invocations can serve deliveries at once.
- Each D1 statement is one atomic step. `authenticateMerchant`'s `find`, mint, `fetchShopGid` and `insert` are separate steps, and anything can happen between them.
- Shopify answers a mint and the `shop { id }` query only while it has the app installed. A stored token counts as fresh at any time, even after Shopify revoked it, because `freshToken` reads only its expiry.
- Activation (the guard's `isEmptyStore` and `find`, then `SqliteMigrator.run`) runs inside `blockConcurrencyWhile`, so no other call reaches the object until it ends. The guard's D1 read is its own step, so D1 can change between the read and the migration.
- Each call that an activated object serves is one step, and `destroy`'s `deleteAll`, `sync` and `abort` are one step. In workerd the input gate admits another call while a call awaits anything but storage, such as a procedure's D1 read or `destroy`'s `CLOSE_HANDSHAKE_WAIT`. The model leaves those interleavings out.
- A socket's procedures write the app's tables. `revoke` writes nothing. Cloudflare can evict an idle activation at any time. The next call then activates from storage: with a migrated store it skips the row read, as the kit does.
- Left out: the orphan sweep (`destroyOrphan`; its reinstall race is accepted in the shop-actor rules), the app's own alarm, the input gate opening during `destroy`'s close-handshake wait (`CLOSE_HANDSHAKE_WAIT`), the plan check's refusals (402), token expiry and `ensureSession`, `app/scopes_update`, the compliance topics, HMAC checks, and more than one shop.

## Is my change covered?

The model's actions map to code. Paths are under `packages/shopify-app-cloudflare/src/internal/`. The table at the top of the spec says the same.

| Action                                    | Code                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Install`, `Uninstall`, `Duplicate`       | Shopify: the install record, one `app/uninstalled` per uninstall, at-least-once delivery                                   |
| `MerchantStart`, `FindFresh`, `FindStale` | `shopify.ts` `authenticateMerchant`: `installations.find`, `freshToken`                                                    |
| `Mint`                                    | `shopify.ts` `tokens.mint` (`AppNotInstalledError` → 503); with a stored row, `updateToken`                                |
| `ShopGid`, `Insert`                       | `shopify.ts` `fetchShopGid`, then `app-installation-store.ts` `insert` (`on conflict do nothing`)                          |
| `Gate`                                    | `actor-upgrade.ts` `merchantGate` → `merchant-gate.ts` `merchantStanding` (no row → 410)                                   |
| `PlanList`                                | `subscription-plan.ts` revalidation over `listShopsWithStalePlan`, then `afterPlanRevalidated` → `shop-actors.ts` `revoke` |
| `HandlerTake`, `HandlerDelete`            | `webhooks.ts` `appUninstalled`: `installations.delete`, then `hooks.afterUninstall`                                        |
| `CallEnter`, `GuardRead`, `GuardDecide`   | `shop-actor-kit.ts` `make`: `isEmptyStore`, `appInstallations.find`, `ShopNotInstalledError`, `SqliteMigrator.run`         |
| `Serve`                                   | `shop-actor-kit.ts` `fetch` and socket procedures; `revoke`                                                                |
| `Destroy`, `DestroyFail`                  | `shop-actor-kit.ts` `destroy`; `shop-actors.ts` `destroy`, `settleDestroy`, `shopActorHooks`                               |
| `Evict`                                   | Cloudflare evicting an idle object                                                                                         |

**Sync commit: the commit that last changed this line, checked 2026-11-18** (a commit cannot name its own hash, so a sync bumps the date). At that commit the model was confirmed to describe the code above. To see whether covered code changed since:

```sh
cd packages/shopify-app-cloudflare/src/internal && git diff "$(git log -1 --format=%h -G'^\*\*Sync commit' -- ../../../../.claude/skills/verify-shop-lifecycle/SKILL.md)" -- webhooks.ts shop-actors.ts shop-actor-kit.ts shopify.ts app-installation-store.ts merchant-gate.ts actor-upgrade.ts subscription-plan.ts hooks.ts
```

In `shopify.ts` only `authenticateMerchant` and `fetchShopGid` count. In `app-installation-store.ts` only `find`, `insert` and `delete` count. In `subscription-plan.ts` only the revalidation's row read and its `afterPlanRevalidated` call count. In `actor-upgrade.ts` only `merchantGate` and `forwardToActor` count. A diff elsewhere in those files does not touch the model.

## When a change touches covered code

1. Find the action or actions in the table. Decide what the change does to them: it reorders steps (such as `destroy` before `delete`), removes a step (such as the activation guard), adds an await where others can interleave, adds a fence (such as comparing a delivery with `installedAt`), or changes what a step reads or writes.
2. Mirror the change in the spec. Edit that action and keep the table at the top true. Add a variable if the change brings state that the rules depend on, such as the delivery's trigger time. Use names from the code.
3. Run `vp run verify:shop-lifecycle`.
4. Tell a real bug from a modeling error. Turn the counterexample into the code's steps (`/statechart` gives it in plain words), and ask whether each step can happen in the code. If one cannot, because the model allows an interleaving the code forbids, fix the model and say why in a comment. If every step can, it is a real bug. Report it with that sequence, and do not weaken a rule, the bounds or the assumptions to make it pass. To replay one on the real code, `apps/testbed/test/integ/shop-actor.test.ts` drives uninstall, reinstall and the plan cron in workerd. Run it from `apps/testbed` with `vp test run --project integ test/integ/shop-actor.test.ts`.
5. A fix for a known finding makes its config pass, and `check.sh` then fails with `NO LONGER REPRODUCES`. Move the rule into `ShopLifecycle.cfg` (`INVARIANT <Rule>`), delete `<Rule>.cfg`, remove the rule from the loop in `check.sh`, and remove it from the known findings above.
6. When the model again describes the code and `check.sh` passes, update the sync commit line above, in this file only, in the commit you checked. Update it only after you confirm that every row of the table still points at code that does what the action says.

A change that leaves the covered code alone needs none of this.

## Each rule can fail

These broken variants of the model each mirror a real code change. Rerun one when you doubt that a rule still catches a break.

| Variant (code change it mirrors)                                                                                                           | Rule TLC reports                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `GuardRead` sets `guardSaw` to `TRUE` (the kit migrates an empty store without reading the row)                                            | StorageOnlyWithRow                |
| `HandlerTake` goes to `"call"`, `Destroy` to `"delete"`, `HandlerDelete` to `"idle"` (`appUninstalled` destroys before it deletes the row) | StorageOnlyWithRow                |
| the code as it is                                                                                                                          | UninstallErasesShop, NoStaleErase |

`tlc.sh` finds Java through the repo's `mise.toml`, so put a variant inside the repo, such as `verification/_variant/`. Run it there, and delete it after.

For more on keeping this in step with the code, see the pstack `/maintain-formal-verification-skill` skill.
