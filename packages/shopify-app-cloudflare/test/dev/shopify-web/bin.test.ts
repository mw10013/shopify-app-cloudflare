import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const BIN = path.resolve(import.meta.dirname, "../../../src/dev/shopify-web/bin.ts");

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let scratch: string;
let appRoot: string;
let fakeBin: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shopify-web-bin-")));
  appRoot = path.join(scratch, "app");
  fs.mkdirSync(appRoot);
  fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "web-app" }));
  fakeBin = path.join(scratch, "bin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(
    path.join(fakeBin, "alchemy"),
    [
      "#!/bin/sh",
      `sleep 30 & echo $! > "${path.join(scratch, "sibling.pid")}"`,
      `printf '%s\\n' "$PWD" "$WEBSITE_PORT" "$@" > "${path.join(scratch, "alchemy.args")}"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterEach(() => {
  const siblingPid = path.join(scratch, "sibling.pid");
  if (fs.existsSync(siblingPid)) {
    const sibling = Number(fs.readFileSync(siblingPid, "utf8"));
    if (alive(sibling)) process.kill(sibling, "SIGKILL");
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** Detached: the bin signals its whole process group, which would otherwise include Vitest. */
const shopifyWeb = (env: Record<string, string>) =>
  new Promise<{ stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [BIN], {
      cwd: appRoot,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, USER: "dev1", ...env },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", () => {
      resolve({ stderr });
    });
  });

describe("shopify-web", () => {
  it("publishes the endpoint, runs alchemy dev on the stage, then signals its group", async () => {
    const endpoint = path.join(scratch, "endpoint.json");
    await shopifyWeb({
      BACKEND_PORT: "41234",
      APP_URL: "https://quick-tunnel.trycloudflare.com",
      RIGGING_ENDPOINT: endpoint,
      SANDBOX_ENVIRONMENT: "e2e",
    });
    expect(JSON.parse(fs.readFileSync(endpoint, "utf8"))).toEqual({
      port: 41_234,
      url: "https://quick-tunnel.trycloudflare.com",
    });
    expect(fs.readFileSync(path.join(scratch, "alchemy.args"), "utf8").split("\n")).toEqual([
      appRoot,
      "41234",
      "dev",
      "--stage",
      "e2e-dev1",
      "",
    ]);
    const sibling = Number(fs.readFileSync(path.join(scratch, "sibling.pid"), "utf8"));
    await expect.poll(() => alive(sibling)).toBe(false);
  });

  it("names the fix when rigging server did not start it", async () => {
    const run = await shopifyWeb({ BACKEND_PORT: "41234", APP_URL: "https://x.example" });
    expect(run.stderr).toContain("start the server with vp run dev or vp run e2e:start");
    expect(fs.existsSync(path.join(scratch, "alchemy.args"))).toBe(false);
  });
});
