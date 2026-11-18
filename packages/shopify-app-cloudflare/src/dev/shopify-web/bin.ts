#!/usr/bin/env node
/**
 * `shopify-web`, the Shopify CLI's web command (`shopify.web.toml`) for a server rigging server
 * runs. It publishes the port and tunnel the CLI injects to rigging server, then runs `alchemy dev`
 * on the checkout's stage, in the server's process group. When `alchemy dev` exits, it signals that
 * whole group, so the CLI and its tunnel exit too and rigging server sees the server stop instead of
 * a CLI that serves nothing.
 *
 * @module
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { app } from "@mw10013/rigging/core/app";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { webEnvironment } from "#dev/web.ts";
import { stage } from "#dev/worktree.ts";

const WebCommand = Config.all({
  environment: webEnvironment,
  port: Config.Port("BACKEND_PORT"),
  url: Config.URL("APP_URL"),
  endpoint: Config.NonEmptyString("RIGGING_ENDPOINT"),
});

const signalProcessGroup = Effect.sync(() => process.kill(0, "SIGTERM"));

Effect.gen(function* () {
  const web = yield* WebCommand;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(web.endpoint, JSON.stringify({ port: web.port, url: web.url.origin }));
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner.exitCode(
    ChildProcess.make("alchemy", ["dev", "--stage", yield* stage(web.environment)], {
      cwd: app().root,
      env: { WEBSITE_PORT: String(web.port) },
      extendEnv: true,
      detached: false,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
}).pipe(
  Effect.catchTag("ConfigError", (error) =>
    Console.error(
      `shopify-web: ${error.message}: start the server with vp run dev or vp run e2e:start`,
    ),
  ),
  Effect.tapError((error) => Console.error(`shopify-web: ${error.message}`)),
  Effect.ignore,
  Effect.ensuring(signalProcessGroup),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
