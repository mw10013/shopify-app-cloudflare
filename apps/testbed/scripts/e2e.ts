#!/usr/bin/env vpx
/**
 * `vp run e2e:start | e2e:status | e2e:restart`: this checkout's long-lived e2e server, which every
 * e2e run reuses, as the package runs it. A schema change needs `restart`, which deletes the
 * stage's local data.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { e2eServerCommand } from "@mw10013/shopify-app-workers/test/e2e/server";
import * as Command from "effect/cli/Command";
import * as Effect from "effect/Effect";

import { STORE_SCOPES } from "./lib/store-auth.ts";

e2eServerCommand({
  // D1 is migrated only when the stage's database is created, so a schema change needs `restart`.
  restartFiles: [
    "package.json",
    "../../pnpm-lock.yaml",
    "alchemy.run.ts",
    "migrations",
    "../../packages/shopify-app-workers/package.json",
  ],
  storeScopes: STORE_SCOPES,
}).pipe(Command.run({ version: "1.0.0" }), Effect.provide(NodeServices.layer), NodeRuntime.runMain);
