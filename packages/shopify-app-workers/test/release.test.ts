import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PACKAGE } from "#scripts/build.ts";
import { release, REPO } from "#scripts/release.ts";

const git = (directory: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();

const initRepository = (directory: string, bare = false) => {
  mkdirSync(directory, { recursive: true });
  git(directory, "init", "--quiet", "-b", "main", ...(bare ? ["--bare"] : []));
  git(directory, "config", "user.email", "release@test");
  git(directory, "config", "user.name", "release");
  git(directory, "config", "commit.gpgsign", "false");
  git(directory, "config", "tag.gpgsign", "false");
};

let scratch: string;
let origin: string;
let repo: string;
let verified: number;

const verify = Effect.sync(() => {
  verified += 1;
});

const publish = (version: string, dryRun = false) =>
  Effect.runPromise(
    release({ repo, version, dryRun, verify }).pipe(Effect.provide(NodeServices.layer)),
  );

const tagsOf = (directory: string) =>
  git(directory, "tag", "--list", "v*").split("\n").filter(Boolean);

const TREE =
  /^(?:package\.json|README\.md|LICENSE|dist\/.+\.(?:mjs|d\.mts)|migrations\/[^/]+\.sql)$/u;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "shopify-app-workers-release-")));
  origin = path.join(scratch, "origin.git");
  repo = path.join(scratch, "repo");
  verified = 0;
  initRepository(origin, true);
  initRepository(repo);
  git(repo, "remote", "add", "origin", origin);
  mkdirSync(path.join(repo, "packages/shopify-app-workers"), { recursive: true });
  writeFileSync(path.join(repo, "packages/shopify-app-workers/package.json"), "{}\n");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "initial");
  git(repo, "push", "--quiet", "origin", "main");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("release", () => {
  it("tags v0.1.0 on a commit holding only the built package, and pushes only the tag", async () => {
    const source = git(repo, "rev-parse", "HEAD");
    const released = await publish("0.1.0");

    assert.strictEqual(verified, 1);
    assert.deepInclude(released, {
      tag: "v0.1.0",
      source,
      parent: null,
      tagged: true,
      pushed: true,
    });
    assert.deepStrictEqual(
      released.files.filter((file) => !TREE.test(file)),
      [],
      "the tree holds only package.json, README.md, LICENSE, dist/ modules and migrations",
    );
    assert.includeMembers(released.files, [
      "package.json",
      "README.md",
      "LICENSE",
      "dist/backend.mjs",
      "dist/backend.d.mts",
      "migrations/0000_swa_01_app_installation.sql",
    ]);
    assert.strictEqual(git(repo, "cat-file", "-t", "v0.1.0"), "tag");
    assert.strictEqual(git(repo, "rev-parse", "v0.1.0^{tree}"), released.tree);
    assert.strictEqual(git(origin, "rev-parse", "v0.1.0^{commit}"), released.commit);
    assert.strictEqual(git(origin, "branch", "--contains", released.commit), "");
    assert.strictEqual(git(origin, "rev-parse", "main"), source);
    assert.strictEqual(git(repo, "status", "--porcelain"), "");

    assert.strictEqual(
      `${git(repo, "show", "v0.1.0:README.md")}\n`,
      readFileSync(path.join(PACKAGE, "README.md"), "utf8"),
    );
    assert.strictEqual(
      `${git(repo, "show", "v0.1.0:LICENSE")}\n`,
      readFileSync(path.join(REPO, "LICENSE"), "utf8"),
    );
  });

  it("stamps the version into a manifest with no workspace protocol and no private flag", async () => {
    await publish("0.1.0");
    const text = git(repo, "show", "v0.1.0:package.json");
    const manifest = JSON.parse(text) as Record<string, unknown>;

    assert.strictEqual(manifest.version, "0.1.0");
    assert.notProperty(manifest, "private");
    assert.notInclude(text, "catalog:");
    assert.notInclude(text, "workspace:");
    assert.deepStrictEqual(manifest.files, ["dist", "migrations"]);
  });

  it("succeeds again for the same version and tree, creating nothing", async () => {
    const first = await publish("0.1.0");
    verified = 0;
    const again = await publish("0.1.0");

    assert.deepInclude(again, {
      existing: true,
      commit: first.commit,
      tree: first.tree,
      tagged: false,
      pushed: false,
    });
    assert.strictEqual(verified, 0);
    assert.deepStrictEqual(tagsOf(repo), ["v0.1.0"]);
    assert.deepStrictEqual(tagsOf(origin), ["v0.1.0"]);
  });

  it("creates no tag on a dry run, locally or on origin", async () => {
    const dry = await publish("0.1.0", true);

    assert.deepInclude(dry, { tagged: false, pushed: false, dryRun: true });
    assert.include(dry.files, "package.json");
    assert.deepStrictEqual(tagsOf(repo), []);
    assert.deepStrictEqual(tagsOf(origin), []);
  });
});
