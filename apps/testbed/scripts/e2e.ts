#!/usr/bin/env vpx

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { e2eServerCommand } from "@mw10013/shopify-app-cloudflare/test/e2e/server";
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
    "../../packages/shopify-app-cloudflare/package.json",
  ],
  storeScopes: STORE_SCOPES,
}).pipe(Command.run({ version: "1.0.0" }), Effect.provide(NodeServices.layer), NodeRuntime.runMain);
