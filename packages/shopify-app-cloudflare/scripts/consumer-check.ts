#!/usr/bin/env vpx
/**
 * Installs the package as a stranger would and uses every entry: a throwaway project in a fresh
 * temporary directory outside the repo, with no credentials (a `HOME` of its own, no git config,
 * no git prompt, and no variable of this process but `PATH` and `TMPDIR`).
 * `vpx scripts/consumer-check.ts [spec] [--keep]` checks `spec` (`0.5.0`, `file:<tgz>`) or,
 * without one, the tarball `npm pack` makes of a fresh `vp run build`'s `dist/`, the tree
 * `npm publish ./dist` ships ({@link packDist}). It prints each step's outcome, exits non-zero when
 * any fails, and removes the temporary directory unless `--keep`.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";

import { build, OUTPUT, PACKAGE } from "./build.ts";

const NAME = "@mw10013/shopify-app-cloudflare";

const WORKSPACE = path.dirname(path.dirname(PACKAGE));

/** Every public entry. */
const SUBPATHS = [
  "backend",
  "contract",
  "stack",
  "website",
  "website/react",
  "client",
  "test",
  "test/node",
  "test/e2e",
  "test/e2e/backend",
  "test/e2e/server",
  "test/e2e/config",
  "dev/agent-chrome",
  "dev/app-handle",
  "dev/embedded-app",
  "dev/local-route",
  "dev/server",
  "dev/stage-store",
  "dev/stores",
  "dev/web",
  "dev/worktree",
] as const;

/** The entries a consumer loads in Node, which must load there. */
const NODE_REQUIRED: readonly string[] = [
  "contract",
  "stack",
  "test",
  "test/node",
  "test/e2e",
  "test/e2e/server",
  "test/e2e/config",
  ...SUBPATHS.filter((subpath) => subpath.startsWith("dev/")),
];

const COMPATIBILITY_DATE = "2026-07-01";

/**
 * The tools beside the package's peers. `rolldown` and `@alchemy.run/cloudflare-runtime` bundle
 * the Worker as Alchemy bundles one; their versions are the ones `alchemy` resolves in this
 * workspace.
 */
const DEV_TOOLS = {
  "@types/node": "26.6.4",
  typescript: "7.0.2",
  miniflare: "4.20260730.0",
  rolldown: "1.2.13",
} as const;

class CheckFailedError extends Data.TaggedError("CheckFailedError")<{ readonly message: string }> {}

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

const source = readJson(path.join(PACKAGE, "package.json"));
const { packageManager } = readJson(path.join(WORKSPACE, "package.json")) as {
  readonly packageManager: string;
};

const exact = (name: string, ranges: unknown) => {
  const range = (ranges as Record<string, string | undefined>)[name];
  if (range === undefined) throw new Error(`${NAME} declares no ${name}`);
  return range.replace(/^[\^~]/u, "");
};
const peer = (name: string) => exact(name, source.peerDependencies);

/** The throwaway project's manifest: the package under `spec`, its peers, and the tools. */
const consumerManifest = (spec: string) => ({
  name: "consumer-check",
  private: true,
  type: "module",
  packageManager,
  dependencies: {
    [NAME]: spec,
    effect: peer("effect"),
    alchemy: peer("alchemy"),
    "@alchemy.run/cloudflare": peer("@alchemy.run/cloudflare"),
    "@effect/platform-node": peer("@effect/platform-node"),
    playwright: peer("playwright"),
    react: peer("react"),
    "@tanstack/react-router": peer("@tanstack/react-router"),
    "@effect/atom-react": peer("@effect/atom-react"),
    "@mw10013/rigging": peer("@mw10013/rigging"),
  },
  devDependencies: {
    ...DEV_TOOLS,
    "@cloudflare/workers-types": exact("@cloudflare/workers-types", source.devDependencies),
    "@types/react": exact("@types/react", source.devDependencies),
    "@alchemy.run/cloudflare-runtime": peer("@alchemy.run/cloudflare"),
  },
});

/**
 * The project's files besides its manifest. `tsconfig.json` is the testbed's (node and workers
 * types, DOM) made stricter, with `skipLibCheck: false` so that the package's own `.d.mts` files
 * are checked; {@link packageErrors} keeps the errors in them and in `entries.ts`.
 */
const PROJECT_FILES: Record<string, string> = {
  "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: true\n  workerd: true\n",
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "es2023",
      module: "nodenext",
      moduleResolution: "nodenext",
      lib: ["ES2023", "DOM"],
      types: ["node", "@cloudflare/workers-types"],
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      verbatimModuleSyntax: true,
      noUnusedLocals: true,
      noUncheckedIndexedAccess: true,
    },
    files: ["entries.ts"],
  }),
  "entries.ts": SUBPATHS.map(
    (subpath) => `export * as ${subpath.replaceAll(/[/-]/gu, "_")} from "${NAME}/${subpath}";\n`,
  ).join(""),
  "node-imports.mjs": `const results = [];
for (const entry of ${JSON.stringify(SUBPATHS)}) {
  try {
    const module = await import("${NAME}/" + entry);
    results.push({ entry, ok: true, exports: Object.keys(module).length });
  } catch (error) {
    results.push({ entry, ok: false, error: String(error?.message ?? error).split("\\n")[0] });
  }
}
console.log(JSON.stringify(results));
`,
  "worker.ts": `import * as backend from "${NAME}/backend";
import * as website from "${NAME}/website";
import * as e2eBackend from "${NAME}/test/e2e/backend";

export default {
  fetch: () =>
    Response.json({
      backend: Object.keys(backend).length,
      website: Object.keys(website).length,
      e2eBackend: Object.keys(e2eBackend).length,
    }),
};
`,
  "bundle-worker.mjs": `import cloudflare from "@alchemy.run/cloudflare-runtime/rolldown";
import { rolldown } from "rolldown";

const bundle = await rolldown({
  input: "worker.ts",
  external: ["lightningcss", "fsevents"],
  plugins: [
    cloudflare({ compatibilityDate: "${COMPATIBILITY_DATE}", compatibilityFlags: ["nodejs_compat"] }),
  ],
  checks: { unresolvedImport: false, ineffectiveDynamicImport: false },
  transform: { define: { "globalThis.__ALCHEMY_RUNTIME__": "true" } },
});
await bundle.write({ dir: "worker", format: "esm", entryFileNames: "worker.mjs", strictExecutionOrder: true });
`,
  "run-worker.mjs": `import { readdirSync } from "node:fs";
import path from "node:path";
import { Miniflare } from "miniflare";

const chunks = readdirSync("worker").filter((file) => /\\.m?js$/u.test(file) && file !== "worker.mjs");
const mf = new Miniflare({
  modulesRoot: "worker",
  modules: ["worker.mjs", ...chunks].map((file) => ({ type: "ESModule", path: path.join("worker", file) })),
  compatibilityDate: "${COMPATIBILITY_DATE}",
  compatibilityFlags: ["nodejs_compat"],
});
try {
  const response = await mf.dispatchFetch("http://localhost/");
  console.log(response.status, await response.text());
  if (response.status !== 200) process.exitCode = 1;
} finally {
  await mf.dispose();
}
`,
  "playwright.config.ts": `import { E2E_SPECS_DIR, e2eProjects } from "${NAME}/test/e2e";
import { defineConfig } from "playwright/test";

if (!E2E_SPECS_DIR.includes("/node_modules/"))
  throw new Error("E2E_SPECS_DIR is not under node_modules: " + E2E_SPECS_DIR);

export default defineConfig({
  workers: 1,
  projects: e2eProjects(
    {
      store: "consumer-check",
      appHandle: "consumer-check",
      clientId: "0".repeat(32),
      plans: [{ handle: "basic", name: "Basic" }],
      server: { port: 1, tunnel: "https://consumer-check.invalid" },
      status: { path: "/status", headers: {} },
      webhooks: { config: import.meta.dirname + "/shopify.app.toml", topics: [], record: "/webhooks" },
      restart: { command: ["true"], cwd: import.meta.dirname },
      storeScopes: [],
    },
    import.meta.dirname,
  ),
});
`,
};

/**
 * The environment of every command: `PATH` and `TMPDIR` from this process, a `HOME` of the
 * check's own, and git with no config and no prompt. Nothing else is inherited, so no token or
 * registry credential reaches the install.
 */
const cleanEnv = (home: string): Record<string, string> => ({
  PATH: process.env.PATH ?? "",
  ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
  HOME: home,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  CI: "1",
});

/** Runs `command` in `cwd` under `env` alone; its output, or a failure carrying it. */
const run = Effect.fn("ConsumerCheck.run")(function* (
  cwd: string,
  env: Record<string, string>,
  command: string,
  args: readonly string[],
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const line = `${command} ${args.join(" ")}`;
  const failed = (cause: unknown) => new CheckFailedError({ message: `${line}: ${String(cause)}` });
  const handle = yield* spawner
    .spawn(ChildProcess.make(command, [...args], { cwd, env, extendEnv: false }))
    .pipe(Effect.mapError(failed));
  const output = yield* Stream.mkString(Stream.decodeText(handle.all)).pipe(
    Effect.mapError(failed),
  );
  const exitCode = yield* handle.exitCode.pipe(Effect.mapError(failed));
  return exitCode === ChildProcessSpawner.ExitCode(0)
    ? { ok: true as const, output }
    : { ok: false as const, output: `${line} exited ${String(exitCode)}:\n${output.trim()}` };
}, Effect.scoped);

const succeeded = (result: { readonly ok: boolean; readonly output: string }) =>
  result.ok ? Effect.succeed(result.output) : new CheckFailedError({ message: result.output });

/** Builds `dist/` and packs it as `npm publish ./dist` would. Returns the tarball's `file:` spec. */
const packDist = Effect.fn("ConsumerCheck.packDist")(function* (
  directory: string,
  env: Record<string, string>,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* build(OUTPUT);
  yield* succeeded(yield* run(OUTPUT, env, "npm", ["pack", "--pack-destination", directory]));
  const tarball = (yield* fs.readDirectory(directory)).find((file) => file.endsWith(".tgz"));
  if (tarball === undefined)
    return yield* new CheckFailedError({ message: `npm pack wrote no tarball in ${directory}` });
  return `file:${path.join(directory, tarball)}`;
});

/**
 * The type errors that are the package's: every error but those located in a third-party
 * declaration under `node_modules`, so `entries.ts`, the package's own files and the config count.
 * The rest are in declarations a consumer's `skipLibCheck` hides, such as
 * `@cloudflare/workers-types` against the DOM lib and `@alchemy.run/sql`'s optional `pg` and
 * `mysql2`.
 */
const packageErrors = (output: string) => {
  const errors = output.split("\n").filter((line) => /error TS\d+/u.test(line));
  const ours = errors.filter(
    (line) => !line.includes("node_modules/") || line.includes(`node_modules/${NAME}/`),
  );
  return { ours, others: errors.length - ours.length };
};

interface Step {
  readonly name: string;
  /** Whether a failure here leaves nothing for the later steps to check. */
  readonly gates: boolean;
  readonly check: Effect.Effect<
    string,
    unknown,
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  >;
}

interface StepResult {
  readonly name: string;
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly detail: string;
}

const steps = (root: string, spec: string | undefined): readonly Step[] => {
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const env = cleanEnv(home);
  const inProject = (command: string, args: readonly string[]) => run(project, env, command, args);
  const bin = (name: string) => path.join(project, "node_modules", ".bin", name);
  const resolved = { spec: spec ?? "" };
  return [
    {
      name: "spec",
      gates: true,
      check: Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(home, { recursive: true });
        if (spec === undefined) resolved.spec = yield* packDist(root, env);
        return resolved.spec;
      }),
    },
    {
      name: "write package.json",
      gates: true,
      check: Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(project);
        yield* fs.writeFileString(
          path.join(project, "package.json"),
          JSON.stringify(consumerManifest(resolved.spec), undefined, 2),
        );
        for (const [file, content] of Object.entries(PROJECT_FILES))
          yield* fs.writeFileString(path.join(project, file), content);
        return `${NAME}: ${resolved.spec}`;
      }),
    },
    {
      name: "pnpm install writes the lockfile",
      gates: true,
      check: Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* succeeded(
          yield* inProject("pnpm", ["install", "--store-dir", path.join(root, "store-a")]),
        );
        if (!(yield* fs.exists(path.join(project, "pnpm-lock.yaml"))))
          return yield* new CheckFailedError({ message: "pnpm install wrote no pnpm-lock.yaml" });
        return "pnpm-lock.yaml written";
      }),
    },
    {
      name: "pnpm install --frozen-lockfile into a cold store",
      gates: true,
      check: Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(path.join(project, "node_modules"), { recursive: true });
        yield* succeeded(
          yield* inProject("pnpm", [
            "install",
            "--frozen-lockfile",
            "--store-dir",
            path.join(root, "store-b"),
          ]),
        );
        return "installed from the lockfile alone";
      }),
    },
    {
      name: `tsc --noEmit over all ${String(SUBPATHS.length)} entries`,
      gates: false,
      check: Effect.gen(function* () {
        const { ok, output } = yield* inProject(bin("tsc"), ["--noEmit", "-p", "tsconfig.json"]);
        const { ours, others } = packageErrors(output);
        if (ours.length > 0) return yield* new CheckFailedError({ message: ours.join("\n") });
        // A failed run with no diagnostic at all is tsc crashing, not third-party errors.
        if (!ok && others === 0) return yield* new CheckFailedError({ message: output });
        return `no error in entries.ts or ${NAME}'s declarations (strict, skipLibCheck false); ${String(others)} in third-party declarations`;
      }),
    },
    {
      name: "import the entries in Node",
      gates: false,
      check: Effect.gen(function* () {
        const output = yield* succeeded(yield* inProject("node", ["node-imports.mjs"]));
        const imported = JSON.parse(output.trim().split("\n").at(-1) ?? "[]") as readonly {
          readonly entry: string;
          readonly ok: boolean;
          readonly error?: string;
        }[];
        const report = imported
          .map(({ entry, ok, error = "" }) => (ok ? entry : `${entry} (cannot load: ${error})`))
          .join(", ");
        const loaded = new Set(imported.filter(({ ok }) => ok).map(({ entry }) => entry));
        if (NODE_REQUIRED.some((entry) => !loaded.has(entry)))
          return yield* new CheckFailedError({ message: report });
        return report;
      }),
    },
    {
      name: "the stores bin lists an empty pool",
      gates: false,
      check: Effect.gen(function* () {
        const output = yield* succeeded(yield* inProject(bin("stores"), ["list"]));
        if (!output.includes("stores: 0 pooled"))
          return yield* new CheckFailedError({ message: output });
        return output.trim().split("\n").at(-1) ?? "";
      }),
    },
    {
      name: "workerd serves /backend, /website and /test/e2e/backend",
      gates: false,
      check: Effect.gen(function* () {
        yield* succeeded(yield* inProject("node", ["bundle-worker.mjs"]));
        const output = yield* succeeded(yield* inProject("node", ["run-worker.mjs"]));
        return output.trim().split("\n").at(-1) ?? "";
      }),
    },
    {
      name: "playwright test --list from node_modules",
      gates: false,
      check: Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const output = yield* succeeded(yield* inProject(bin("playwright"), ["test", "--list"]));
        const installed = path.join(project, "node_modules", NAME, "dist", "test", "e2e");
        const specs = (yield* fs.readDirectory(installed))
          .filter((file) => /\.(?:spec|setup)\.mjs$/u.test(file))
          .map((file) => file.replace(/\.mjs$/u, ""));
        const unlisted = specs.filter((spec) => !output.includes(`${spec}.`));
        if (specs.length === 0 || unlisted.length > 0)
          return yield* new CheckFailedError({
            message: `unlisted: ${unlisted.join(", ") || "no spec in the package"}\n${output.trim()}`,
          });
        return `${specs.join(", ")}; ${/Total: .*/u.exec(output)?.[0] ?? ""}`;
      }),
    },
  ];
};

const check = Effect.fn("ConsumerCheck.check")(function* (spec: string | undefined, keep: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* Effect.acquireRelease(
    fs.makeTempDirectory({ prefix: "shopify-app-cloudflare-consumer-" }),
    (directory) =>
      keep ? Effect.void : fs.remove(directory, { recursive: true }).pipe(Effect.ignore),
  );
  const results: StepResult[] = [];
  let blockedBy: string | undefined;
  for (const { name, gates, check: stepCheck } of steps(root, spec)) {
    if (blockedBy !== undefined) {
      results.push({ name, status: "SKIP", detail: `${blockedBy} failed` });
      continue;
    }
    const outcome = yield* Effect.result(stepCheck);
    if (outcome._tag === "Success") results.push({ name, status: "PASS", detail: outcome.success });
    else {
      const { failure } = outcome;
      results.push({
        name,
        status: "FAIL",
        detail: failure instanceof CheckFailedError ? failure.message : String(failure),
      });
      if (gates) blockedBy = name;
    }
  }
  return { results, kept: keep ? root : undefined };
}, Effect.scoped);

const summary = (results: readonly StepResult[]) =>
  results
    .map(
      ({ name, status, detail }, index) =>
        `${String(index + 1)}. ${status} ${name}\n   ${detail.replaceAll("\n", "\n   ")}`,
    )
    .join("\n");

if (import.meta.main) {
  const args = process.argv.slice(2);
  const spec = args.find((arg) => !arg.startsWith("--"));
  NodeRuntime.runMain(
    check(spec, args.includes("--keep")).pipe(
      Effect.flatMap(({ results, kept }) =>
        Effect.sync(() => {
          console.log(summary(results));
          if (kept !== undefined) console.log(`kept: ${kept}`);
          if (results.some(({ status }) => status === "FAIL")) process.exitCode = 1;
        }),
      ),
      Effect.provide(NodeServices.layer),
    ),
  );
}
