import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const BIN = path.resolve(import.meta.dirname, "../../../src/dev/shopify-browser/bin.ts");

let scratch: string;
let appRoot: string;
let calls: string;
let tabFile: string;
let fakeBin: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shopify-browser-bin-")));
  appRoot = path.join(scratch, "app");
  fs.mkdirSync(appRoot);
  fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "browser-app" }));
  tabFile = path.join(appRoot, ".playwright-cli", "browser-tab.json");
  calls = path.join(scratch, "vp.calls");
  fakeBin = path.join(scratch, "bin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(
    path.join(fakeBin, "vp"),
    ["#!/bin/sh", `printf '%s\\0' "$*" >> "${calls}"`, ""].join("\n"),
    { mode: 0o755 },
  );
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const shopifyBrowser = (...args: string[]) =>
  new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: appRoot,
      stdio: ["ignore", "pipe", "inherit"],
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, HOME: scratch },
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("close", (code) => {
      resolve({ code, stdout });
    });
  });

const vpCalls = () => fs.readFileSync(calls, "utf8").split("\0").slice(0, -1);

describe("shopify-browser close", () => {
  it("closes no tab when open recorded none, and detaches", async () => {
    const run = await shopifyBrowser("close");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("closing none");
    expect(vpCalls()).toEqual(["exec playwright cli -s=dev detach"]);
  });

  it("closes only the tab open recorded, forgets it, and detaches", async () => {
    fs.mkdirSync(path.dirname(tabFile), { recursive: true });
    fs.writeFileSync(tabFile, JSON.stringify({ targetId: "TARGET-OURS" }));
    const run = await shopifyBrowser("close");
    expect(run.code).toBe(0);
    const [closeTab, detach, ...rest] = vpCalls();
    expect(closeTab).toContain("exec playwright cli -s=dev --raw run-code");
    expect(closeTab).toContain('info.targetId === "TARGET-OURS"');
    expect(closeTab).toContain("Target.closeTarget");
    expect(closeTab).not.toContain("page.close()");
    expect(detach).toBe("exec playwright cli -s=dev detach");
    expect(rest).toEqual([]);
    expect(fs.existsSync(tabFile)).toBe(false);
  });
});
