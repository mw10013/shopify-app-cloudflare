import * as Effect from "effect/Effect";
import { RunningServer, Server, ServerError } from "@mw10013/devkit/shopify/server";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as FileSystem from "effect/FileSystem";
/** What {@link e2eServerCommand} needs of an app. */
export interface E2eServerOptions<R = never> {
  /**
   * The files, relative to the app's root, whose change since the server started needs a refresh;
   * a directory stands for every file in it. `status` names the changed ones.
   */
  readonly restartFiles: readonly string[];
  /** The store auth scopes the app's suite needs (its `E2eApp` `storeScopes`); none skips it. */
  readonly storeScopes: readonly string[];
  /**
   * The app's own preparation of the store, on every start once store auth is granted. The store
   * is already recorded when it runs, so it cannot use the record to tell a new store from one it
   * prepared; it checks the store itself.
   */
  readonly prepareStore?: (server: Server, running: RunningServer) => Effect.Effect<void, ServerError, R>;
}
/**
 * The `e2e` command an app's `scripts/e2e.ts` runs, behind `vp run e2e:start | e2e:status |
 * e2e:restart`; the spec pack's lifecycle runs `reinstall` as its `E2eApp` `restart`. The app runs
 * it with `Command.run` under `NodeServices.layer`.
 *
 * @example
 * ```ts
 * e2eServerCommand({ restartFiles: ["package.json", "migrations"], storeScopes: ["read_products"] }).pipe(
 *   Command.run({ version: "1.0.0" }),
 *   Effect.provide(NodeServices.layer),
 *   NodeRuntime.runMain,
 * );
 * ```
 */
export declare const e2eServerCommand: <R = never>({ restartFiles, storeScopes, prepareStore }: E2eServerOptions<R>) => Command.Command<"e2e", {}, {}, CliError.UserError, import("effect/process/ChildProcessSpawner").ChildProcessSpawner | FileSystem.FileSystem | Exclude<Exclude<R, "effect/cli/GlobalFlag/log-level">, Command.CommandContext<"e2e">>>;