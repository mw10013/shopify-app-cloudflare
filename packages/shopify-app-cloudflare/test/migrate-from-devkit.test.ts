import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyRules, migrate, rewriteManifest, sourceRules } from "#scripts/migrate-from-devkit.ts";

const source = [
  `import { app } from "@mw10013/devkit/core/app";`,
  `import { lint } from '@mw10013/devkit/core/lint/rules';`,
  `import { workerNameOf } from "@mw10013/devkit/cloudflare/stage";`,
  `import { runningServer } from "@mw10013/devkit/shopify/server";`,
  `import { stage } from "#rigging/cloudflare/stage.ts";`,
  `import { appHandle } from "#rigging/shopify/app-handle.ts";`,
  "// See `@mw10013/devkit/core/test-runs`.",
  `globalSetup: ["@mw10013/devkit/cloudflare/integ-setup"],`,
  `const endpoint = process.env.BOSUN_ENDPOINT;`,
  `import { Berth } from "./berth.ts";`,
].join("\n");

describe("sourceRules", () => {
  it("moves core and cloudflare to rigging and shopify to the package's dev modules", () => {
    assert.strictEqual(
      applyRules(source, sourceRules(false)),
      [
        `import { app } from "@mw10013/rigging/core/app";`,
        `import { lint } from '@mw10013/rigging/core/lint/rules';`,
        `import { workerNameOf } from "@mw10013/rigging/cloudflare/stage";`,
        `import { runningServer } from "@mw10013/shopify-app-cloudflare/dev/server";`,
        `import { stage } from "@mw10013/rigging/cloudflare/stage";`,
        `import { appHandle } from "@mw10013/shopify-app-cloudflare/dev/app-handle";`,
        "// See `@mw10013/rigging/core/test-runs`.",
        `globalSetup: ["@mw10013/rigging/cloudflare/integ-setup"],`,
        `const endpoint = process.env.RIGGING_ENDPOINT;`,
        `import { Berth } from "./berth.ts";`,
      ].join("\n"),
    );
  });

  it("maps the shopify modules to #dev in the package's own source", () => {
    assert.strictEqual(
      applyRules(
        `import { runningServer } from "@mw10013/devkit/shopify/server";\nimport { appHandle } from "#rigging/shopify/app-handle.ts";`,
        sourceRules(true),
      ),
      `import { runningServer } from "#dev/server.ts";\nimport { appHandle } from "#dev/app-handle.ts";`,
    );
  });
});

describe("rewriteManifest", () => {
  it("rewrites the scripts' devkit and bosun commands and leaves the rest", () => {
    const manifest = {
      name: "app",
      scripts: {
        "dev:alchemy": `printf '{}' > "$BOSUN_ENDPOINT" && alchemy dev`,
        "dev:stop": "bosun stop dev",
        "e2e:logs": "bosun logs e2e",
        port: "devkit-bosun-port",
        stage: "devkit-stage",
        logs: "devkit-logs",
        test: "vp test run",
        "check:pin": "devkit check-pin",
      },
      dependencies: { "@mw10013/devkit": "catalog:" },
    };
    assert.deepStrictEqual(JSON.parse(rewriteManifest(JSON.stringify(manifest))), {
      ...manifest,
      scripts: {
        "dev:alchemy": `printf '{}' > "$RIGGING_ENDPOINT" && alchemy dev`,
        "dev:stop": "rigging server stop dev",
        "e2e:logs": "rigging server logs e2e",
        port: "rigging server port",
        stage: "rigging stage",
        logs: "rigging logs",
        test: "vp test run",
      },
    });
  });

  it("returns the text unchanged when no script changes", () => {
    const text = `{"name":"app","scripts":{"test":"vp test run"}}`;
    assert.strictEqual(rewriteManifest(text), text);
  });
});

describe("migrate", () => {
  it.effect("rewrites files, skips directories named like sources and leaves refs alone", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(path.join(tmpdir(), "migrate-from-devkit-"));
      mkdirSync(path.join(root, "src", "snapshot.test.ts"), { recursive: true });
      mkdirSync(path.join(root, "refs", "other"), { recursive: true });
      const devkitImport = `import { app } from "@mw10013/devkit/core/app";\n`;
      writeFileSync(path.join(root, "src", "app.ts"), devkitImport);
      writeFileSync(path.join(root, "refs", "other", "app.ts"), devkitImport);
      const changed = yield* migrate([root], false);
      assert.deepStrictEqual(changed, [path.join(root, "src", "app.ts")]);
      assert.strictEqual(
        readFileSync(path.join(root, "src", "app.ts"), "utf8"),
        `import { app } from "@mw10013/rigging/core/app";\n`,
      );
      assert.strictEqual(
        readFileSync(path.join(root, "refs", "other", "app.ts"), "utf8"),
        devkitImport,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
