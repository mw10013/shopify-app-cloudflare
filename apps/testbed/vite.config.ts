import cloudflare from "@alchemy.run/cloudflare-runtime/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { defineConfig } from "vite-plus";

import { testRunDirectory } from "#devkit/core/test-runs.ts";
import { webEnvironmentSync } from "#devkit/shopify/web.ts";
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
      // Every run's results stay in its own directory (`#devkit/core/test-runs.ts`), failures included.
      ...(mode === "test"
        ? {
            reporters: [
              "default",
              ["json", { outputFile: `${testRunDirectory("test")}/results.json` }],
            ],
          }
        : {}),
      include: ["test/unit/**/*.test.ts"],
    },
  };
});
