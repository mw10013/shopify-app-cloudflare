import {
  existsSync,
  globSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { build, builtManifest, E2E_ENTRIES, entriesOf, PACKAGE } from "#scripts/build.ts";

import { reachedPackages } from "./reach.ts";

const source = JSON.parse(readFileSync(path.join(PACKAGE, "package.json"), "utf8")) as Record<
  string,
  unknown
>;
const manifest = builtManifest(source);

let scratch: string;
let dist: string;

beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "shopify-app-cloudflare-build-")));
  dist = path.join(scratch, "dist");
  await Effect.runPromise(build(scratch).pipe(Effect.provide(NodeServices.layer)));
}, 120_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const inScratch = (file: string) => path.join(scratch, file);

const builtFiles = () =>
  readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".mjs") || file.endsWith(".d.mts"))
    .map((file) => path.join(dist, file));

const specifiersOf = (file: string) =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /^(?:import|export)\s[^;"']*?from\s*["'](?<named>[^"']+)["']|^import\s*["'](?<bare>[^"']+)["']|\bimport\(\s*["'](?<dynamic>[^"']+)["']\s*\)/gmu,
    ),
  ].map(({ groups }) => groups?.named ?? groups?.bare ?? groups?.dynamic ?? "");

const isRelative = (specifier: string) => specifier.startsWith(".");

const packageOf = (specifier: string) => {
  const [first = "", second = ""] = specifier.split("/");
  return specifier.startsWith("@") ? `${first}/${second}` : first;
};

const reachedFrom = (file: string) => {
  const bare = new Set<string>();
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const specifier of specifiersOf(current))
      if (isRelative(specifier)) {
        const target = path.resolve(path.dirname(current), specifier);
        visit(current.endsWith(".d.mts") ? target.replace(/\.mjs$/u, ".d.mts") : target);
      } else {
        bare.add(specifier);
      }
  };
  visit(file);
  return bare;
};

const reachedFromExport = (key: string) => {
  const target = manifest.exports[key];
  if (target === undefined) throw new Error(`no export ${key}`);
  return new Set([
    ...reachedFrom(inScratch(target.default)),
    ...reachedFrom(inScratch(target.types)),
  ]);
};

const NODE_ONLY = ["node:fs", "node:sqlite"];

describe("builtManifest", () => {
  it("maps each export into dist, ships dist and migrations, and drops the workspace's fields", () => {
    assert.deepStrictEqual(
      builtManifest({
        name: "@mw10013/shopify-app-cloudflare",
        version: "0.5.0",
        private: true,
        files: ["src", "migrations"],
        type: "module",
        scripts: { build: "vpx scripts/build.ts" },
        imports: { "#internal/*": "./src/internal/*" },
        exports: { "./backend": "./src/backend.ts", "./test/node": "./src/test-node.ts" },
        bin: { stores: "./src/dev/stores/bin.ts" },
        dependencies: { "@shopify/shopify-api": "15.0.1" },
        devDependencies: { vitest: "catalog:" },
        peerDependencies: { effect: "^4.1.2" },
      }),
      {
        name: "@mw10013/shopify-app-cloudflare",
        version: "0.5.0",
        files: ["dist", "migrations"],
        type: "module",
        exports: {
          "./backend": { types: "./dist/backend.d.mts", default: "./dist/backend.mjs" },
          "./test/node": { types: "./dist/test-node.d.mts", default: "./dist/test-node.mjs" },
        },
        bin: { stores: "dist/dev/stores/bin.mjs" },
        dependencies: { "@shopify/shopify-api": "15.0.1" },
        peerDependencies: { effect: "^4.1.2" },
      },
    );
  });

  it("lists exactly the source's exports, and builds each one as an entry", () => {
    const sourceExports = source.exports as Record<string, string>;
    assert.deepStrictEqual(Object.keys(manifest.exports), Object.keys(sourceExports));
    assert.includeMembers([...entriesOf(source)], Object.values(sourceExports));
  });
});

describe("the built package", () => {
  it("is the tree npm publishes: the built manifest, LICENSE, README and the migrations", () => {
    assert.deepStrictEqual(readdirSync(scratch).toSorted(), [
      "LICENSE",
      "README.md",
      "dist",
      "migrations",
      "package.json",
    ]);
    assert.deepStrictEqual(JSON.parse(readFileSync(inScratch("package.json"), "utf8")), manifest);
  });

  it("has a script and a declaration file behind every export", () => {
    for (const [key, target] of Object.entries(manifest.exports)) {
      assert.include(builtFiles(), inScratch(target.default), key);
      assert.include(builtFiles(), inScratch(target.types), key);
    }
  });

  it("ships each bin as an executable script with its shebang", () => {
    assert.deepStrictEqual(Object.keys(manifest.bin), ["app-token-key", "stores"]);
    for (const target of Object.values(manifest.bin)) {
      assert.include(builtFiles(), inScratch(target));
      assert.isTrue(readFileSync(inScratch(target), "utf8").startsWith("#!/usr/bin/env node\n"));
      assert.notStrictEqual(statSync(inScratch(target)).mode & 0o111, 0);
    }
  });

  it("emits every e2e spec, setup and preflight under dist/test/e2e", () => {
    const sources = E2E_ENTRIES.flatMap((pattern) => globSync(pattern, { cwd: PACKAGE }));
    assert.isAtLeast(sources.length, 5);
    for (const file of sources)
      assert.include(
        builtFiles(),
        path.join(dist, "test/e2e", path.basename(file).replace(/\.ts$/u, ".mjs")),
      );
  });

  it("names no .ts file and no # import map in a module specifier", () => {
    const files = builtFiles();
    assert.isNotEmpty(files);
    assert.deepStrictEqual(
      files.flatMap((file) =>
        specifiersOf(file)
          .filter((specifier) => /\.m?ts$/u.test(specifier) || specifier.startsWith("#"))
          .map((specifier) => `${path.relative(dist, file)}: ${specifier}`),
      ),
      [],
    );
  });

  it("imports only Node, its dependencies and its peers", () => {
    const declared = new Set(
      ["dependencies", "peerDependencies"].flatMap((field) =>
        Object.keys(manifest[field] as Record<string, string>),
      ),
    );
    assert.deepStrictEqual(
      builtFiles().flatMap((file) =>
        specifiersOf(file)
          .filter(
            (specifier) =>
              !isRelative(specifier) &&
              !specifier.startsWith("node:") &&
              !declared.has(packageOf(specifier)),
          )
          .map((specifier) => `${path.relative(dist, file)}: ${specifier}`),
      ),
      [],
    );
  });

  it("bundles nothing from node_modules: each built module mirrors a source module", () => {
    const strays = readdirSync(dist, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".mjs") || file.endsWith(".d.mts"))
      .map((file) => path.join(PACKAGE, "src", file.replace(/\.(?:d\.mts|mjs)$/u, "")))
      .filter((stem) => !existsSync(`${stem}.ts`) && !existsSync(`${stem}.tsx`));
    assert.deepStrictEqual(strays, []);
  });

  it("keeps the Worker entries' graphs as clear of node:fs and node:sqlite as their sources", () => {
    for (const [key, entry] of [
      ["./backend", "backend.ts"],
      ["./contract", "contract.ts"],
      ["./website", "website.ts"],
      ["./website/react", "website-react.ts"],
      ["./client", "client.ts"],
      ["./stack", "stack.ts"],
      ["./test/e2e/backend", "test-e2e-backend.ts"],
    ] as const) {
      const baseline = NODE_ONLY.filter((name) => reachedPackages(entry).includes(name));
      assert.deepStrictEqual(
        NODE_ONLY.filter((name) => reachedFromExport(key).has(name)),
        baseline,
        key,
      );
    }
  });

  it("keeps the backend's side-effect import of Shopify's web-api adapter", () => {
    assert.isTrue(reachedFromExport("./backend").has("@shopify/shopify-api/adapters/web-api"));
  });

  it("finds the package's migrations beside dist from the built test/node", async () => {
    const { PACKAGE_MIGRATIONS_DIR } = (await import(
      pathToFileURL(path.join(dist, "test/node/migrations.mjs")).href
    )) as { readonly PACKAGE_MIGRATIONS_DIR: string };
    assert.strictEqual(PACKAGE_MIGRATIONS_DIR, inScratch("migrations"));
    assert.deepStrictEqual(
      readdirSync(PACKAGE_MIGRATIONS_DIR).filter((name) => name.startsWith("0000_sac_")),
      ["0000_sac_01_app_installation.sql", "0000_sac_02_better_auth.sql"],
    );
  });
});
