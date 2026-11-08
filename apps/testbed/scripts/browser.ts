#!/usr/bin/env vpx
import { createHash } from "node:crypto";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Deployed } from "@mw10013/devkit/cloudflare/stage";
import { app } from "@mw10013/devkit/core/app";
import { runCommand } from "@mw10013/devkit/core/command";
import {
  AGENT_CDP,
  checkShopifyLogin,
  ensureAgentChrome,
  loginAgentChrome,
} from "@mw10013/devkit/shopify/agent-chrome";
import { appHandle } from "@mw10013/devkit/shopify/app-handle";
import * as Berth from "@mw10013/devkit/shopify/berth";
import {
  appFrame,
  awaitHydration,
  closeDevConsole,
  gotoApp,
  prepareApp,
} from "@mw10013/devkit/shopify/embedded-app";
import { runningServer } from "@mw10013/devkit/shopify/server";
import { storeNameOf } from "@mw10013/devkit/shopify/worktree";
import * as Argument from "effect/cli/Argument";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";

class BrowserError extends Schema.TaggedError<BrowserError>()("BrowserError", {
  message: Schema.String,
}) {}

const session = "dev";

const isServerRunning = Schema.is(
  Schema.String.check(Schema.isPattern(/^chrome-devtools-mcp daemon is running\./u)),
);

const runCLI = Effect.fn("Browser.runCLI")(function* (args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make("vp", ["exec", "playwright", "cli", `-s=${session}`, ...args], {
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  const code = yield* child.exitCode;
  if (code !== ChildProcessSpawner.ExitCode(0)) {
    return yield* new BrowserError({
      message:
        "Browser command failed; see output above. Check vp run dev:status, then vp run browser agent.",
    });
  }
}, Effect.scoped);

/**
 * The CLI's run-code VM cannot import modules, so the shared helpers are serialized here with their
 * whole closure; a new helper dependency joins this list. Node's TypeScript loader erases types
 * before `Function.toString` sees them.
 */
const readinessCode = (url?: string) => `async (page) => {
  const appFrame = ${appFrame.toString()};
  const awaitHydration = ${awaitHydration.toString()};
  const closeDevConsole = ${closeDevConsole.toString()};
  const prepareApp = ${prepareApp.toString()};
  const gotoApp = ${gotoApp.toString()};
  await ${url === undefined ? "prepareApp(page)" : `gotoApp(page, ${JSON.stringify(url)})`};
  return { ready: true };
}`;

const ready = Effect.gen(function* () {
  yield* runCLI(["--raw", "run-code", readinessCode()]);
  yield* runCLI(["snapshot", "--filename=.playwright-cli/dev-ready.yml"]);
});

const devStore = Berth.acquire("dev").pipe(Effect.map((lease) => lease.store));

/**
 * The chrome-devtools server's session id comes from the checkout's path, so a restart here never
 * drops another checkout's server.
 */
const agent = Effect.gen(function* () {
  const started = yield* ensureAgentChrome;
  yield* checkShopifyLogin(yield* devStore);
  const sessionId = `--sessionId=${createHash("sha256").update(app().root).digest("hex").slice(0, 12)}`;
  const missingCli = () =>
    new BrowserError({
      message:
        "chrome-devtools failed. Install it with vp install -g --node lts chrome-devtools-mcp@latest.",
    });
  const status = yield* runCommand("chrome-devtools", ["status", sessionId]).pipe(
    Effect.mapError(missingCli),
  );
  if (started || !isServerRunning(status)) {
    yield* runCommand("chrome-devtools", [
      "start",
      sessionId,
      `--browserUrl=${AGENT_CDP}`,
      "--no-usage-statistics",
      "--no-performance-crux",
    ]).pipe(Effect.mapError(missingCli));
  }
  yield* Console.log(
    `Ready: agent Chrome ${AGENT_CDP}, logged in. chrome-devtools <tool> ${sessionId}`,
  );
});

const login = Effect.gen(function* () {
  yield* loginAgentChrome(yield* devStore);
  yield* agent;
});

const close = runCLI(["--raw", "run-code", "async (page) => { await page.close(); }"]).pipe(
  Effect.ignore,
  Effect.andThen(runCLI(["detach"])),
);

const Target = Schema.Literals(["dev", ...Deployed.literals]);
type Target = typeof Target.Type;

const targetFlag = Flag.Literals("stage", Target.literals).pipe(
  Flag.withDescription("dev (this checkout's dev store), staging or production"),
  Flag.withDefault("dev"),
);

const adminUrl = Effect.fn("Browser.adminUrl")(function* (target: Target, path: string) {
  const store = target === "dev" ? yield* devStore : storeNameOf(target, 0);
  const tomlFile = target === "dev" ? "shopify.app.toml" : `shopify.app.${target}.toml`;
  const handle = yield* Effect.try({
    try: () => appHandle(tomlFile),
    catch: (cause) =>
      new BrowserError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });
  return `https://admin.shopify.com/store/${store}/apps/${handle}/${path}`;
});

const checkDevServer = runningServer("dev").pipe(
  Effect.mapError((error) => new BrowserError({ message: error.message })),
);

const open = Effect.fn("Browser.open")(function* (target: Target) {
  const url = yield* adminUrl(target, "app");
  if (target === "dev") yield* checkDevServer;
  yield* agent;
  yield* close.pipe(Effect.ignore);
  yield* Effect.gen(function* () {
    yield* runCLI(["attach", `--cdp=${AGENT_CDP}`]);
    yield* runCLI(["tab-new"]);
    yield* runCLI(["--raw", "run-code", readinessCode(url)]);
    yield* runCLI(["snapshot", "--filename=.playwright-cli/dev-ready.yml"]);
    yield* Console.log(`Ready: session=dev; ${url}; snapshot=.playwright-cli/dev-ready.yml`);
  }).pipe(Effect.onError(() => close.pipe(Effect.ignore)));
});

const goto = Effect.fn("Browser.goto")(function* (target: Target, path: string) {
  yield* runCLI(["--raw", "run-code", readinessCode(yield* adminUrl(target, path))]);
});

const toUserError = (error: { readonly message: string }) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

Command.make("browser").pipe(
  Command.withDescription(
    "Drive the embedded app in the agent Chrome, on the dev store or a deployed stage",
  ),
  Command.withSubcommands([
    Command.make("agent", {}, () => agent.pipe(Effect.mapError(toUserError))),
    Command.make("login", {}, () => login.pipe(Effect.mapError(toUserError))),
    Command.make("open", { stage: targetFlag }, ({ stage }) =>
      open(stage).pipe(Effect.mapError(toUserError)),
    ),
    Command.make(
      "goto",
      { stage: targetFlag, path: Argument.String("path").pipe(Argument.withDefault("app")) },
      ({ stage, path }) => goto(stage, path).pipe(Effect.mapError(toUserError)),
    ),
    Command.make("ready", {}, () => ready.pipe(Effect.mapError(toUserError))),
    Command.make("close", {}, () => close.pipe(Effect.mapError(toUserError))),
  ]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
