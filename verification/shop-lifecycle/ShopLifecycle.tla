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
(* PlanList                   subscription-plan.ts `revalidateStalePlans`: *)
(*                            the row from `listShopsWithStalePlan`        *)
(* PlanAsk                    its `tokens.mint`: AppNotInstalledError ->   *)
(*                            uninstall.ts `uninstallShop`; else `refresh` *)
(*                            -> `afterPlanRevalidated` -> shop-actors.ts  *)
(*                            `revoke` -> `getByName(shop).revoke()`       *)
(* HandlerTake, HandlerAsk    webhooks.ts `appUninstalled`: `tokens.mint`; *)
(*                            AppNotInstalledError -> `uninstallShop`      *)
(* HandlerCheck               the mint succeeded: `installations.find`;    *)
(*                            a row -> `reinstalled`, nothing erased; none *)
(*                            -> `afterUninstall` alone                    *)
(* UninstallDelete            uninstall.ts `uninstallShop`:                *)
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
(*                            (the cron's failed destroy is left out)      *)
(* Evict                      Cloudflare evicts an idle object from memory *)
(***************************************************************************)
EXTENDS Naturals, TLC

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
    unchecked,
    raced,
    staleErase

vars == <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
          deliveries, dupes, fails, planRuns, started, pc, stored, guardSaw, reported, unchecked, raced, staleErase>>

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
    /\ unchecked = FALSE
    /\ raced = FALSE
    /\ staleErase = FALSE

Kind(p) ==
    IF p \in MerchantRequests THEN "fetch"
    ELSE IF p = Plan /\ reported[Plan] = 0 THEN "revoke"
    ELSE "destroy"

Erasing(p) == Kind(p) = "destroy" /\ pc[p] \in {"check", "delete", "call", "guard", "decide", "serve"}

Live(k) == k = installation /\ shopify = "installed"

Goto(p, s) == pc' = [pc EXCEPT ![p] = s]

----------------------------------------------------------------------------

Install ==
    /\ shopify = "uninstalled"
    /\ uninstalls < MaxUninstalls
    /\ shopify' = "installed"
    /\ installation' = installation + 1
    /\ raced' = (raced \/ \E p \in Procs : Erasing(p))
    /\ UNCHANGED <<uninstalls, row, rowInstallation, store, storeInstallation, activated, serving, deliveries,
                   dupes, fails, planRuns, started, pc, stored, guardSaw, reported, unchecked, staleErase>>

Uninstall ==
    /\ shopify = "installed"
    /\ uninstalls < MaxUninstalls
    /\ shopify' = "uninstalled"
    /\ uninstalls' = uninstalls + 1
    /\ deliveries' = [deliveries EXCEPT ![installation] = @ + 1]
    /\ UNCHANGED <<installation, row, rowInstallation, store, storeInstallation, activated, serving, dupes, fails,
                   planRuns, started, pc, stored, guardSaw, reported, unchecked, raced, staleErase>>

Duplicate(e) ==
    /\ dupes < MaxDuplicates
    /\ e < installation \/ (e = installation /\ shopify = "uninstalled")
    /\ dupes' = dupes + 1
    /\ deliveries' = [deliveries EXCEPT ![e] = @ + 1]
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   fails, planRuns, started, pc, stored, guardSaw, reported, unchecked, raced, staleErase>>

----------------------------------------------------------------------------

MerchantStart(p) ==
    /\ p \in MerchantRequests \ started
    /\ pc[p] = "idle"
    /\ shopify = "installed"  \* the merchant has the app open, so holds an ID token
    /\ started' = started \cup {p}
    /\ Goto(p, "find")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, stored, guardSaw, reported, unchecked, raced, staleErase>>

FindFresh(p) ==
    /\ pc[p] = "find"
    /\ row
    /\ stored' = [stored EXCEPT ![p] = TRUE]
    /\ Goto(p, "gate")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, guardSaw, reported, unchecked, raced, staleErase>>

FindStale(p) ==
    /\ pc[p] = "find"
    /\ stored' = [stored EXCEPT ![p] = row]
    /\ Goto(p, "mint")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, guardSaw, reported, unchecked, raced, staleErase>>

Mint(p) ==
    /\ pc[p] = "mint"
    /\ Goto(p, IF shopify = "uninstalled" THEN "idle"
               ELSE IF stored[p] THEN "gate" ELSE "gid")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, unchecked, raced, staleErase>>

ShopGid(p) ==
    /\ pc[p] = "gid"
    /\ Goto(p, IF shopify = "uninstalled" THEN "idle" ELSE "insert")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, unchecked, raced, staleErase>>

Insert(p) ==
    /\ pc[p] = "insert"
    /\ row' = TRUE
    /\ rowInstallation' = IF row THEN rowInstallation ELSE installation
    /\ unchecked' = (unchecked \/ ~row)
    /\ raced' = (raced \/ (~row /\ \E q \in Procs : Erasing(q)))
    /\ Goto(p, "gate")
    /\ UNCHANGED <<shopify, installation, uninstalls, store, storeInstallation, activated, serving, deliveries,
                   dupes, fails, planRuns, started, stored, guardSaw, reported, staleErase>>

Gate(p) ==
    /\ pc[p] = "gate"
    /\ Goto(p, IF row THEN "call" ELSE "idle")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, unchecked, raced, staleErase>>

----------------------------------------------------------------------------

PlanList ==
    /\ pc[Plan] = "idle"
    /\ planRuns < PlanRuns \/ unchecked
    /\ planRuns' = IF unchecked THEN planRuns ELSE planRuns + 1
    /\ unchecked' = (unchecked /\ row)
    /\ reported' = [reported EXCEPT ![Plan] = 0]
    /\ Goto(Plan, IF row THEN "ask" ELSE "idle")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, started, stored, guardSaw, raced, staleErase>>

PlanAsk ==
    /\ pc[Plan] = "ask"
    /\ unchecked' = FALSE
    /\ IF shopify = "uninstalled"
         THEN /\ reported' = [reported EXCEPT ![Plan] = installation]
              /\ Goto(Plan, "delete")
         ELSE /\ UNCHANGED reported
              /\ Goto(Plan, "call")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, raced, staleErase>>

----------------------------------------------------------------------------

HandlerTake(h, e) ==
    /\ h \in Handlers
    /\ pc[h] = "idle"
    /\ deliveries[e] > 0
    /\ deliveries' = [deliveries EXCEPT ![e] = @ - 1]
    /\ reported' = [reported EXCEPT ![h] = e]
    /\ Goto(h, "ask")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   dupes, fails, planRuns, started, stored, guardSaw, unchecked, raced, staleErase>>

HandlerAsk(h) ==
    /\ pc[h] = "ask"
    /\ Goto(h, IF shopify = "installed" THEN "check" ELSE "delete")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, unchecked, raced, staleErase>>

HandlerCheck(h) ==
    /\ pc[h] = "check"
    /\ Goto(h, IF row THEN "idle" ELSE "call")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, unchecked, raced, staleErase>>

UninstallDelete(h) ==
    /\ pc[h] = "delete"
    /\ row' = FALSE
    /\ staleErase' = (staleErase \/ (row /\ Live(rowInstallation)))
    /\ Goto(h, "call")
    /\ UNCHANGED <<shopify, installation, uninstalls, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, guardSaw, reported, unchecked, raced>>

----------------------------------------------------------------------------

Finish(p, failed) ==
    /\ Goto(p, "idle")
    /\ deliveries' = IF failed /\ p \in Handlers THEN [deliveries EXCEPT ![reported[p]] = @ + 1] ELSE deliveries

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
                   dupes, fails, planRuns, started, stored, guardSaw, reported, unchecked, raced, staleErase>>

GuardRead(p) ==
    /\ pc[p] = "guard"
    /\ guardSaw' = [guardSaw EXCEPT ![p] = row]
    /\ Goto(p, "decide")
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, serving,
                   deliveries, dupes, fails, planRuns, started, stored, reported, unchecked, raced, staleErase>>

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
                   stored, guardSaw, reported, unchecked, raced, staleErase>>

Serve(p) ==
    /\ pc[p] = "serve"
    /\ Kind(p) # "destroy"
    /\ storeInstallation' = IF Kind(p) = "fetch" THEN (IF row THEN installation ELSE 0) ELSE storeInstallation
    /\ raced' = (raced \/ (Kind(p) = "fetch" /\ \E q \in Procs : Erasing(q)))
    /\ serving' = None
    /\ Finish(p, FALSE)
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, activated, dupes, fails,
                   planRuns, started, stored, guardSaw, reported, unchecked, staleErase>>

Destroy(h) ==
    /\ pc[h] = "serve"
    /\ Kind(h) = "destroy"
    /\ staleErase' = (staleErase \/ Live(storeInstallation))
    /\ store' = "empty"
    /\ activated' = FALSE
    /\ serving' = None
    /\ Finish(h, FALSE)
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, storeInstallation, dupes, fails,
                   planRuns, started, stored, guardSaw, reported, unchecked, raced>>

DestroyFail(h) ==
    /\ pc[h] = "serve"
    /\ Kind(h) = "destroy"
    /\ fails < MaxFailures
    /\ fails' = fails + 1
    /\ serving' = None
    /\ Finish(h, TRUE)
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, activated, dupes,
                   planRuns, started, stored, guardSaw, reported, unchecked, raced, staleErase>>

Evict ==
    /\ activated
    /\ serving = None
    /\ activated' = FALSE
    /\ UNCHANGED <<shopify, installation, uninstalls, row, rowInstallation, store, storeInstallation, serving,
                   deliveries, dupes, fails, planRuns, started, pc, stored, guardSaw, reported, unchecked,
                   raced, staleErase>>

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
    \/ PlanList \/ PlanAsk
    \/ \E h \in Handlers, e \in Installations : HandlerTake(h, e)
    \/ \E h \in Handlers : HandlerAsk(h) \/ HandlerCheck(h)
    \/ \E h \in Handlers \cup {Plan} : UninstallDelete(h) \/ Destroy(h)
    \/ \E h \in Handlers : DestroyFail(h)
    \/ \E p \in Procs : CallEnter(p) \/ GuardRead(p) \/ GuardDecide(p) \/ Serve(p)
    \/ Evict
    \/ Settled

Spec == Init /\ [][Next]_vars

Symmetry == Permutations(Handlers) \cup Permutations(MerchantRequests)

----------------------------------------------------------------------------

StorageOnlyWithRow == Quiescent => (store = "migrated" => row)

UninstallErasesShop ==
    (Quiescent /\ ~unchecked /\ shopify = "uninstalled") => (~row /\ store = "empty")

NoStaleErase == ~staleErase

StaleEraseOnlyWhenRaced == staleErase => raced

TypeOK ==
    /\ shopify \in {"installed", "uninstalled"}
    /\ row \in BOOLEAN /\ activated \in BOOLEAN
    /\ store \in {"empty", "migrated"}
    /\ serving \in Procs \cup {None}
    /\ activated => store = "migrated"

=============================================================================
