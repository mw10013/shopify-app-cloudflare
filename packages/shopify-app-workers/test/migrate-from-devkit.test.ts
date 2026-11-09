import { assert, describe, it } from "@effect/vitest";

import { applyRules, rewriteManifest, sourceRules } from "#scripts/migrate-from-devkit.ts";

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
        `import { runningServer } from "@mw10013/shopify-app-workers/dev/server";`,
        `import { stage } from "@mw10013/rigging/cloudflare/stage";`,
        `import { appHandle } from "@mw10013/shopify-app-workers/dev/app-handle";`,
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
