import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";

import {
  E2E_PREFLIGHT,
  E2E_TRACE,
  type E2eApp,
  e2eProject,
  e2eProjects,
  LIFECYCLE_PROJECT,
  LIFECYCLE_SPEC_MATCH,
  SHOPIFY_ADMIN_PROJECT,
  SPEC_MATCH,
  statusUrl,
  webhookRecordUrl,
} from "#test/e2e/app.ts";

const app: E2eApp = {
  store: "pool-01",
  appHandle: "testbed",
  clientId: "0123456789abcdef0123456789abcdef",
  plans: [{ handle: "basic", name: "Basic" }],
  server: { port: 8787, tunnel: "https://e2e.example.com" },
  status: { path: "/status", headers: {} },
  webhooks: { config: "/app/shopify.app.toml", topics: [], record: "/webhooks-record" },
  restart: { command: ["true"], cwd: "/app" },
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

  it("runs after the admin login export and the lifecycle, on the pack's shared options", () => {
    const [admin, lifecycle, specs] = e2eProjects(app, "/app");
    assert.deepStrictEqual(lifecycle?.dependencies, [admin?.name]);
    assert.deepStrictEqual(specs?.dependencies, [admin?.name, lifecycle?.name]);
    assert.deepStrictEqual(specs?.use?.storageState, admin?.use?.adminAuthFile);
  });

  it("runs the lifecycle alone in its project, and an app's own specs after it", () => {
    const [, lifecycle, specs] = e2eProjects(app, "/app");
    assert.deepStrictEqual(lifecycle?.testMatch, LIFECYCLE_SPEC_MATCH);
    assert.deepStrictEqual(specs?.testIgnore, LIFECYCLE_SPEC_MATCH);
    const own = e2eProject(app, "/app", {
      name: "own",
      testDir: "/app/e2e",
      testMatch: SPEC_MATCH,
    });
    assert.deepStrictEqual(own.dependencies, [SHOPIFY_ADMIN_PROJECT, LIFECYCLE_PROJECT]);
    for (const file of ["lifecycle.spec.ts", "lifecycle.spec.js"])
      assert.isTrue(LIFECYCLE_SPEC_MATCH.test(file) && SPEC_MATCH.test(file), file);
    assert.isFalse(LIFECYCLE_SPEC_MATCH.test("smoke.spec.ts"));
  });
});

describe("statusUrl", () => {
  it("reads the status route on the server's local port, for the shop", () => {
    assert.strictEqual(
      statusUrl(
        { ...app, server: { port: 9001, tunnel: "https://t.example.com" } },
        "pool-01.myshopify.com",
      ).href,
      "http://localhost:9001/status?shop=pool-01.myshopify.com",
    );
  });

  it("refuses a route path that resolves to another origin, which would get the token", () => {
    assert.throws(
      () => statusUrl({ ...app, status: { path: "//other.example/status", headers: {} } }, "s"),
      /resolves to http:\/\/other\.example, not the e2e server's http:\/\/localhost:8787/u,
    );
    assert.throws(
      () =>
        webhookRecordUrl({ ...app, webhooks: { ...app.webhooks, record: "//other.example/r" } }),
      /resolves to http:\/\/other\.example/u,
    );
    assert.strictEqual(webhookRecordUrl(app).href, "http://localhost:8787/webhooks-record");
  });
});

describe("the built package", () => {
  it("matches specs as source and as built JavaScript", () => {
    for (const file of ["smoke.spec.ts", "smoke.spec.js", "smoke.spec.mjs", "smoke.spec.cts"])
      assert.isTrue(SPEC_MATCH.test(file), file);
    assert.isFalse(SPEC_MATCH.test("smoke.spec.d.ts.map"));
  });

  it("names the preflight with this module's own extension", () => {
    assert.isTrue(E2E_PREFLIGHT.endsWith("/test/e2e/preflight.ts"), E2E_PREFLIGHT);
  });
});
