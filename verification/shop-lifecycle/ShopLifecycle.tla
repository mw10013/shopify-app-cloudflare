---------------------------- MODULE ShopLifecycle ----------------------------
(***************************************************************************)
(* One shop's install and uninstall across Shopify, its AppInstallation   *)
(* row in D1, and its ShopActor Durable Object.  Paths are under           *)
(* packages/shopify-app-cloudflare/src/internal/.                           *)
(*                                                                         *)
(* Action                     Code                                         *)
(* ------------------------   -------------------------------------------- *)
(* Install, Uninstall         Shopify's record of the install; Uninstall   *)
(*                            sends one `app/uninstalled` delivery         *)
(* Duplicate                  Shopify delivers a webhook again (at least   *)
(*                            once, or a retry after a slow 2xx)           *)
(* MerchantStart, FindFresh,  shopify.ts `authenticateMerchant`: `find`,   *)
(*   FindStale                `freshToken`                                 *)
(* Mint                       `tokens.mint`; AppNotInstalledError -> 503;  *)
(*                            on a stored row `updateToken`, which writes  *)
(*                            nothing to a missing row                     *)
(* ShopGid                    `fetchShopGid` with the minted token; 401    *)
(*                            once Shopify revoked it -> 503               *)
(* Insert                     app-installation-store.ts `insert` (on       *)
(*                            conflict do nothing)                         *)
(* Gate                       actor-upgrade.ts `merchantGate` ->           *)
(*                            merchant-gate.ts `merchantStanding` reads    *)
(*                            the row; none -> 410, no actor call          *)
(* PlanList                   subscription-plan.ts revalidation: the row   *)
(*                            from `listShopsWithStalePlan`, then          *)
(*                            `afterPlanRevalidated` -> shop-actors.ts     *)
(*                            `revoke` -> `getByName(shop).revoke()`       *)
(* HandlerTake, HandlerDelete webhooks.ts `appUninstalled`:                *)
(*                            `installations.delete`, then                 *)
(*                            `afterUninstall` = shop-actors.ts `destroy`  *)
(* CallEnter                  a `getByName(shop)` call reaches the object; *)
(*                            shop-actor-kit.ts activation, inside         *)
(*                            Alchemy's `blockConcurrencyWhile`: a stored  *)
(*                            store migrates (a no-op) with no row read    *)
(* GuardRead, GuardDecide     shop-actor-kit.ts: `isEmptyStore`, then      *)
(*                            `appInstallations.find`; none ->             *)
(*                            ShopNotInstalledError, nothing written;      *)
(*                            found -> `SqliteMigrator.run`                *)
(* Serve                      `fetch` (socket procedures, which write the  *)
(*                            app's tables) or `revoke` (writes nothing)   *)
(* Destroy                    kit `destroy`: `deleteAlarm`, `deleteAll`,   *)
(*                            `sync`, `abort(ABORT_UNINSTALLED)`; the      *)
(*                            caller's `settleDestroy` reads the abort and *)
(*                            the refusal as success                       *)
(* DestroyFail                the destroy call fails before `deleteAll`:   *)
(*                            `settleDestroy` propagates, the webhook      *)
(*                            answers 500, Shopify redelivers              *)
(* Evict                      Cloudflare evicts an idle object from memory *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    MerchantRequests,
    Handlers,
    Plan,
    MaxUninstalls,
    MaxDuplicates,
    MaxFailures,
    PlanRuns

Procs == MerchantRequests \cup Handlers \cup {Plan}
Installations == 1..(MaxUninstalls + 1)
None == "none"

VARIABLES
    shopify,
    installation,
    uninstalls,
    row,
    rowInstallation,
    store,
    storeInstallation,
    activated,
    serving,
    deliveries,
    dupes,
    fails,
    planRuns,
    started,
    pc,
    stored,
    guardSaw,
    reported,
    staleErase

vars == <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
          deliveries, dupes, fails, planRuns, started, pc, stored, guardSaw, reported, staleErase>>

Init ==
    /\ shopify = "installed"
    /\ installation = 1
    /\ uninstalls = 0
    /\ row = TRUE
    /\ rowInstallation = 1
    /\ store = "migrated"
    /\ storeInstallation = 1
    /\ activated = FALSE
    /\ serving = None
    /\ deliveries = [e \in Installations |-> 0]
    /\ dupes = 0
    /\ fails = 0
    /\ planRuns = 0
    /\ started = {}
    /\ pc = [p \in Procs |-> "idle"]
    /\ stored = [p \in Procs |-> FALSE]
    /\ guardSaw = [p \in Procs |-> FALSE]
    /\ reported = [p \in Procs |-> 0]
    /\ staleErase = FALSE

Kind(p) == IF p \in MerchantRequests THEN "fetch" ELSE IF p = Plan THEN "revoke" ELSE "destroy"

Goto(p, s) == pc' = [pc EXCEPT ![p] = s]

----------------------------------------------------------------------------

Install ==
    /\ shopify = "uninstalled"
    /\ uninstalls < MaxUninstalls
    /\ shopify' = "installed"
    /\ installation' = installation + 1
    /\ UNCHANGED <<uninstalls, row, rowInstallation, store, storeInstallation, activated, serving, deliveries,
                   dupes, fails, planRuns, started, pc, stored, guardSaw, reported, staleErase>>

Uninstall ==
    /\ shopify = "installed"
    /\ uninstalls < MaxUninstalls
    /\ shopify' = "uninstalled"
    /\ uninstalls' = uninstalls + 1
    /\ deliveries' = [deliveries EXCEPT ![installation] = @ + 1]
    /\ UNCHANGED <<installation, row, rowInstallation, store, storeInstallation, activated, serving, dupes, fails,
                   planRuns, started, pc, stored, guardSaw, reported, staleErase>>

Duplicate(e) ==
    /\ dupes < MaxDuplicates
    /\ e < installation \/ (e = installation /\ shopify = "uninstalled")
    /\ dupes' = dupes + 1
    /\ deliveries' = [deliveries EXCEPT ![e] = @ + 1]
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   fails, planRuns, started, pc, stored, guardSaw, reported, staleErase>>

----------------------------------------------------------------------------

MerchantStart(p) ==
    /\ p \in MerchantRequests \ started
    /\ pc[p] = "idle"
    /\ shopify = "installed"  \* the merchant has the app open, so holds an ID token
    /\ started' = started \cup {p}
    /\ Goto(p, "find")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, stored, guardSaw, reported, staleErase>>

FindFresh(p) ==
    /\ pc[p] = "find"
    /\ row
    /\ stored' = [stored EXCEPT ![p] = TRUE]
    /\ Goto(p, "gate")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, guardSaw, reported, staleErase>>

FindStale(p) ==
    /\ pc[p] = "find"
    /\ stored' = [stored EXCEPT ![p] = row]
    /\ Goto(p, "mint")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, guardSaw, reported, staleErase>>

Mint(p) ==
    /\ pc[p] = "mint"
    /\ Goto(p, IF shopify = "uninstalled" THEN "idle"
               ELSE IF stored[p] THEN "gate" ELSE "gid")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, staleErase>>

ShopGid(p) ==
    /\ pc[p] = "gid"
    /\ Goto(p, IF shopify = "uninstalled" THEN "idle" ELSE "insert")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, staleErase>>

Insert(p) ==
    /\ pc[p] = "insert"
    /\ row' = TRUE
    /\ rowInstallation' = IF row THEN rowInstallation ELSE installation
    /\ Goto(p, "gate")
    /\ UNCHANGED <<shopify, installation, uninstalls, store, storeInstallation, activated, serving, deliveries,
                   dupes, fails, planRuns, started, stored, guardSaw, reported, staleErase>>

Gate(p) ==
    /\ pc[p] = "gate"
    /\ Goto(p, IF row THEN "call" ELSE "idle")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, staleErase>>

----------------------------------------------------------------------------

PlanList ==
    /\ pc[Plan] = "idle"
    /\ planRuns < PlanRuns
    /\ planRuns' = planRuns + 1
    /\ Goto(Plan, IF row THEN "call" ELSE "idle")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, started, stored, guardSaw, reported, staleErase>>

----------------------------------------------------------------------------

HandlerTake(h, e) ==
    /\ h \in Handlers
    /\ pc[h] = "idle"
    /\ deliveries[e] > 0
    /\ deliveries' = [deliveries EXCEPT ![e] = @ - 1]
    /\ reported' = [reported EXCEPT ![h] = e]
    /\ Goto(h, "delete")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   dupes, fails, planRuns, started, stored, guardSaw, staleErase>>

HandlerDelete(h) ==
    /\ pc[h] = "delete"
    /\ row' = FALSE
    /\ staleErase' = (staleErase \/ (row /\ rowInstallation > reported[h]))
    /\ Goto(h, "call")
    /\ UNCHANGED <<shopify, installation, uninstalls, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported>>

----------------------------------------------------------------------------

Finish(p, failed) ==
    /\ Goto(p, "idle")
    /\ deliveries' = IF failed THEN [deliveries EXCEPT ![reported[p]] = @ + 1] ELSE deliveries

CallEnter(p) ==
    /\ pc[p] = "call"
    /\ serving = None
    /\ serving' = p
    /\ IF activated \/ store = "migrated"
         THEN /\ activated' = TRUE
              /\ Goto(p, "serve")
         ELSE /\ activated' = activated
              /\ Goto(p, "guard")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, deliveries,
                   dupes, fails, planRuns, started, stored, guardSaw, reported, staleErase>>

GuardRead(p) ==
    /\ pc[p] = "guard"
    /\ guardSaw' = [guardSaw EXCEPT ![p] = row]
    /\ Goto(p, "decide")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, reported, staleErase>>

GuardDecide(p) ==
    /\ pc[p] = "decide"
    /\ IF guardSaw[p]
         THEN /\ store' = "migrated"
              /\ storeInstallation' = installation
              /\ activated' = TRUE
              /\ serving' = serving
              /\ Goto(p, "serve")
              /\ UNCHANGED deliveries
         ELSE /\ UNCHANGED <<store, storeInstallation, activated>>
              /\ serving' = None
              /\ Finish(p, FALSE)
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, dupes, fails, planRuns, started,
                   stored, guardSaw, reported, staleErase>>

Serve(p) ==
    /\ pc[p] = "serve"
    /\ Kind(p) # "destroy"
    /\ storeInstallation' = IF Kind(p) = "fetch" THEN installation ELSE storeInstallation
    /\ serving' = None
    /\ Finish(p, FALSE)
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, activated, dupes, fails,
                   planRuns, started, stored, guardSaw, reported, staleErase>>

Destroy(h) ==
    /\ pc[h] = "serve"
    /\ Kind(h) = "destroy"
    /\ staleErase' = (staleErase \/ (storeInstallation > reported[h]))
    /\ store' = "empty"
    /\ activated' = FALSE
    /\ serving' = None
    /\ Finish(h, FALSE)
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, storeInstallation, dupes, fails,
                   planRuns, started, stored, guardSaw, reported>>

DestroyFail(h) ==
    /\ pc[h] = "serve"
    /\ Kind(h) = "destroy"
    /\ fails < MaxFailures
    /\ fails' = fails + 1
    /\ serving' = None
    /\ Finish(h, TRUE)
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, dupes,
                   planRuns, started, stored, guardSaw, reported, staleErase>>

Evict ==
    /\ activated
    /\ serving = None
    /\ activated' = FALSE
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, serving,
                   deliveries, dupes, fails, planRuns, started, pc, stored, guardSaw, reported,
                   staleErase>>

----------------------------------------------------------------------------

Quiescent ==
    /\ \A p \in Procs : pc[p] = "idle"
    /\ \A e \in Installations : deliveries[e] = 0

\* Nothing left to happen. Not a bug; lets TLC tell a stuck run from a finished one.
Settled ==
    /\ Quiescent
    /\ UNCHANGED vars

Next ==
    \/ Install \/ Uninstall \/ \E e \in Installations : Duplicate(e)
    \/ \E p \in MerchantRequests : MerchantStart(p) \/ FindFresh(p) \/ FindStale(p) \/ Mint(p)
                            \/ ShopGid(p) \/ Insert(p) \/ Gate(p)
    \/ PlanList
    \/ \E h \in Handlers, e \in Installations : HandlerTake(h, e)
    \/ \E h \in Handlers : HandlerDelete(h) \/ Destroy(h) \/ DestroyFail(h)
    \/ \E p \in Procs : CallEnter(p) \/ GuardRead(p) \/ GuardDecide(p) \/ Serve(p)
    \/ Evict
    \/ Settled

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------

StorageOnlyWithRow == Quiescent => (store = "migrated" => row)

UninstallErasesShop == (Quiescent /\ shopify = "uninstalled") => (~row /\ store = "empty")

NoStaleErase == ~staleErase

TypeOK ==
    /\ shopify \in {"installed", "uninstalled"}
    /\ row \in BOOLEAN /\ activated \in BOOLEAN
    /\ store \in {"empty", "migrated"}
    /\ serving \in Procs \cup {None}
    /\ activated => store = "migrated"

=============================================================================
