import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";

import {
  E2E_PREFLIGHT,
  E2E_TRACE,
  type E2eApp,
  e2eProject,
  e2eProjects,
  SPEC_MATCH,
} from "#test/e2e/app.ts";

const app: E2eApp = {
  store: "pool-01",
  appHandle: "testbed",
  plans: ["basic"],
  server: { port: 8787, tunnel: "https://e2e.example.com" },
  status: { url: "http://localhost:8787/status", headers: {} },
  storeScopes: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("e2eProject", () => {
  it("keeps no trace, screenshot or video by default, since each can carry the login", () => {
    vi.stubEnv(E2E_TRACE, undefined);
    const { use } = e2eProject(app, "/app", {
      name: "app",
      testDir: "/app/e2e",
      testMatch: SPEC_MATCH,
    });
    assert.strictEqual(use?.trace, "off");
    assert.strictEqual(use?.screenshot, "off");
    assert.strictEqual(use?.video, "off");
  });

  it("keeps failed tests' traces when opted in, with a warning that they hold the login", () => {
    vi.stubEnv(E2E_TRACE, "1");
    vi.stubEnv("TEST_WORKER_INDEX", undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { use } = e2eProject(app, "/app", {
      name: "app",
      testDir: "/app/e2e",
      testMatch: SPEC_MATCH,
    });
    assert.strictEqual(use?.trace, "retain-on-failure");
    assert.match(String(warn.mock.calls[0]?.[0]), /live Shopify admin login/u);
  });

  it("runs after the admin login export, on the pack's shared options", () => {
    const [admin, specs] = e2eProjects(app, "/app");
    assert.deepStrictEqual(specs?.dependencies, [admin?.name]);
    assert.deepStrictEqual(specs?.use?.storageState, admin?.use?.adminAuthFile);
  });
});

describe("the built package", () => {
  it("matches specs as source and as built JavaScript", () => {
    for (const file of ["smoke.spec.ts", "smoke.spec.js", "smoke.spec.mjs", "smoke.spec.cts"])
      assert.isTrue(SPEC_MATCH.test(file), file);
    assert.isFalse(SPEC_MATCH.test("smoke.spec.d.ts.map"));
  });

  it("names the preflight with this module's own extension", () => {
    // The source runs here; the built module would name `preflight.js`.
    assert.isTrue(E2E_PREFLIGHT.endsWith("/test/e2e/preflight.ts"), E2E_PREFLIGHT);
  });
});
