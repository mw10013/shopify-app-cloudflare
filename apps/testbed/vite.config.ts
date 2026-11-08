import { execFileSync } from "node:child_process";

import cloudflare from "@alchemy.run/cloudflare-runtime/vite";
import { app } from "@mw10013/devkit/core/app";
import { testRunDirectory } from "@mw10013/devkit/core/test-runs";
import { webEnvironmentSync } from "@mw10013/devkit/shopify/web";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { defineConfig } from "vite-plus";

const { root } = app(import.meta.dirname);

/** This checkout's stage of `environment`, as `scripts/stage.ts` prints it. */
const stageOf = (environment: "test") =>
  Schema.decodeUnknownSync(Schema.Trim)(
    execFileSync("vpx", ["scripts/stage.ts", environment], { cwd: root, encoding: "utf8" }),
  );

/**
 * Vite's dependency cache, one per server: the dev and e2e servers run in one checkout at once,
 * and a re-optimization by one deletes files the other has loaded (every SSR request then 500s).
 */
const viteCacheDir = () => `node_modules/.vite/${webEnvironmentSync()}`;

const HttpUrl = Schema.String.check(Schema.isPattern(/^https?:\/\//u)).pipe(
  Schema.decodeTo(Schema.URLFromString),
);

/** A URL from an `http(s)://` URL or a bare host, which is read as `https://<host>`. */
const UrlOrHost = Schema.Union([
  HttpUrl,
  Schema.String.pipe(
    Schema.decodeTo(
      HttpUrl,
      SchemaTransformation.transform({
        decode: (host) => `https://${host}`,
        encode: (url) => url.slice("https://".length),
      }),
    ),
  ),
]);

/**
 * Hosts Vite's host check admits. Alchemy's proxy forwards the client's `Host` header untouched,
 * so a page loaded through Shopify CLI's tunnel arrives with the tunnel's hostname, which changes
 * every `shopify app dev` run. `APP_URL` is the tunnel the CLI injected into this run's
 * environment; the CLI may hand it as a URL or a bare host.
 */
const allowedHosts = () => [
  "localhost",
  "127.0.0.1",
  ".trycloudflare.com",
  ...Option.toArray(
    Schema.decodeUnknownOption(UrlOrHost)(process.env.APP_URL).pipe(
      Option.map((url) => url.hostname),
    ),
  ),
];

export default defineConfig(({ command, mode, isPreview }) => {
  if (
    command === "serve" &&
    isPreview === false &&
    process.env.VITEST !== "true" &&
    process.env.VP_RUN !== "1"
  ) {
    throw new Error("Use `vp run dev` to start the project dev server.");
  }

  return {
    plugins:
      mode === "test"
        ? []
        : [
            // Alchemy injects this same plugin on deploy/dev; never instantiate it twice.
            process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"
              ? null
              : cloudflare({
                  compatibilityDate: "2026-07-01",
                  compatibilityFlags: ["nodejs_compat"],
                }),
            tanstackStart({ srcDirectory: "src/web" }),
            react(),
          ],
    cacheDir: command === "serve" ? viteCacheDir() : undefined,
    // No port: `alchemy dev` picks Vite's own behind its public proxy, which serves the lease's.
    // Test runs write HTML reports and traces into `.test-results/`; watched, each write would
    // full-reload every open app page, mid-test.
    server:
      command === "serve"
        ? { allowedHosts: allowedHosts(), watch: { ignored: ["**/.test-results/**"] } }
        : undefined,
    test: {
      passWithNoTests: true,
      // Every run's results stay in its own directory (`@mw10013/devkit/core/test-runs`), failures included.
      ...(mode === "test"
        ? {
            reporters: [
              "default",
              ["json", { outputFile: `${testRunDirectory("test", [], root)}/results.json` }],
            ],
          }
        : {}),
      projects: [
        { test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
        {
          // Deploys the test Backend in workerd through @alchemy.run/test. Files run in parallel,
          // each on its own stage (`fileStage` in test/integ/), one workerd each. ALCHEMY_DEV is
          // read by the Worker's init at plan, so the test process must set it. ALCHEMY_TEST_STAGE
          // is the checkout's `test` stage, which each file's stage extends; it is spawned only
          // under test, so `vp build` and `vp run dev` do not run the script.
          test: {
            name: "integ",
            globalSetup: ["@mw10013/devkit/cloudflare/integ-setup"],
            include: ["test/integ/**/*.test.ts"],
            env:
              mode === "test"
                ? { ALCHEMY_DEV: "1", ALCHEMY_TEST_STAGE: stageOf("test") }
                : { ALCHEMY_DEV: "1" },
            // @alchemy.run/test/Vitest registers its sidecar cleanup after the file's afterAll
            // hooks and expects them to run in that order; Vitest's default runs them in reverse,
            // so `destroy` would wait on a sidecar already closed.
            sequence: { hooks: "list" },
            testTimeout: 30_000,
            hookTimeout: 120_000,
            fileParallelism: true,
            pool: "forks",
          },
        },
      ],
    },
  };
});
