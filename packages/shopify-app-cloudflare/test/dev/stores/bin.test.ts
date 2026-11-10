import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const BIN = path.resolve(import.meta.dirname, "../../../src/dev/stores/bin.ts");

let scratch: string;
let appRoot: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stores-bin-")));
  appRoot = path.join(scratch, "app");
  fs.mkdirSync(appRoot);
  fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "bin-app" }));
  const pool = path.join(scratch, "state", "shopify-app-cloudflare", "stores");
  fs.mkdirSync(pool, { recursive: true });
  fs.writeFileSync(
    path.join(pool, "pool.json"),
    JSON.stringify({ format: 1, stores: ["mw10013-pool-07", "mw10013-pool-08"] }),
  );
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const stores = (...args: string[]) => {
  const run = spawnSync(process.execPath, [BIN, ...args], {
    cwd: appRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", XDG_STATE_HOME: path.join(scratch, "state") },
  });
  const stdout = run.stdout.trim();
  return {
    status: run.status,
    stderr: run.stderr,
    json: stdout.startsWith("{") ? (JSON.parse(stdout) as Record<string, unknown>) : undefined,
    stdout,
  };
};

describe("stores", () => {
  it("shows no lease before one is acquired, and never creates one", () => {
    expect(stores("show", "dev")).toMatchObject({
      status: 0,
      json: { format: 1, lease: null },
    });
    expect(fs.existsSync(path.join(scratch, "state", "berth"))).toBe(false);
  });

  it("acquires idempotently, shows the same lease, and releases it", () => {
    const acquired = stores("acquire", "dev");
    expect(acquired).toMatchObject({
      status: 0,
      json: {
        format: 1,
        project: "bin-app",
        checkout: appRoot,
        env: "dev",
        store: { domain: "mw10013-pool-07.myshopify.com", config: "shopify.app.toml" },
      },
    });
    expect(stores("acquire", "dev").json).toEqual(acquired.json);
    expect(stores("show", "dev").json).toEqual({ format: 1, lease: acquired.json });
    expect(stores("acquire", "e2e").json).toMatchObject({
      store: { domain: "mw10013-pool-08.myshopify.com", config: "shopify.app.e2e.toml" },
    });
    expect(stores("release", "dev").json).toMatchObject({
      released: [{ env: "dev" }],
    });
    expect(stores("show", "dev").json).toEqual({ format: 1, lease: null });
    expect(stores("list").stdout).toContain("stores: 2 pooled, 1 held, 1 free");
  });

  it("prints a typed failure as JSON and exits 1", () => {
    expect(stores("acquire", "staging")).toMatchObject({
      status: 1,
      json: { format: 1, error: { _tag: "UnknownEnvError", env: "staging" } },
    });
  });

  it("exits 1 on a pool or ledger format it does not know", () => {
    fs.writeFileSync(
      path.join(scratch, "state", "shopify-app-cloudflare", "stores", "pool.json"),
      JSON.stringify({ format: 2, stores: [] }),
    );
    expect(stores("acquire", "dev")).toMatchObject({
      status: 1,
      json: { error: { _tag: "UnsupportedFormatError", found: "2" } },
    });
  });

  it("exits 2 on a usage error", () => {
    expect(stores("acquire").status).toBe(2);
    expect(stores("bogus").status).toBe(2);
  });
});
