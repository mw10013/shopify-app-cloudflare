import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  CheckoutPath,
  EnvName,
  MachineName,
  ProjectName,
  StoreDomain,
} from "#dev/stores/domain.ts";
import { Ledger } from "#dev/stores/ledger.ts";
import { ledgerDirectory, LedgerDirectoryConflictError } from "#dev/stores/settings.ts";

let scratch: string;
let previous: string;
let current: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stores-settings-")));
  previous = path.join(scratch, "berth", "ledger");
  current = path.join(scratch, "shopify-app-cloudflare", "stores", "ledger");
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(
      Layer.merge(
        NodeServices.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { XDG_STATE_HOME: scratch } })),
      ),
    ),
  ) as Effect.Effect<A, E>;

const lease = {
  key: {
    machine: MachineName.make("test-mbp"),
    checkout: CheckoutPath.make("/c0"),
    env: EnvName.make("dev"),
  },
  project: ProjectName.make("demo"),
  store: { domain: StoreDomain.make("pool-0.myshopify.com"), config: "shopify.app.toml" },
  acquiredAt: DateTime.makeUnsafe("2026-11-01T09:00:00Z"),
};

const names = (directory: string) =>
  fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("g-"))
    .toSorted();

describe("ledgerDirectory", () => {
  it("is the stores directory, and creates nothing when there is no ledger", async () => {
    expect(await Effect.runPromise(provide(ledgerDirectory))).toBe(current);
    expect(fs.readdirSync(scratch)).toEqual([]);
  });

  it("moves the previous ledger and leaves a symlink to it, on every run", async () => {
    fs.mkdirSync(previous, { recursive: true });
    fs.writeFileSync(path.join(previous, "g-3.json"), '{"leases":[]}');
    for (let run = 0; run < 3; run++)
      expect(await Effect.runPromise(provide(ledgerDirectory))).toBe(current);
    expect(fs.lstatSync(previous).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(previous)).toBe(current);
    expect(fs.lstatSync(current).isDirectory()).toBe(true);
    expect(names(current)).toEqual(["g-3.json"]);
  });

  it("converges when racing processes all find the previous ledger", async () => {
    fs.mkdirSync(previous, { recursive: true });
    fs.writeFileSync(path.join(previous, "g-1.json"), '{"leases":[]}');
    await Effect.runPromise(
      provide(
        Effect.all(
          Array.from({ length: 8 }, () => ledgerDirectory),
          { concurrency: "unbounded" },
        ),
      ),
    );
    expect(fs.readlinkSync(previous)).toBe(current);
    expect(names(current)).toEqual(["g-1.json"]);
  });

  it("fails naming both directories, and writes nothing, when both are real", async () => {
    fs.mkdirSync(previous, { recursive: true });
    fs.mkdirSync(current, { recursive: true });
    fs.writeFileSync(path.join(previous, "g-1.json"), '{"leases":[]}');
    fs.writeFileSync(path.join(current, "g-2.json"), '{"leases":[]}');
    const error = await Effect.runPromise(provide(Effect.flip(ledgerDirectory)));
    expect(error).toBeInstanceOf(LedgerDirectoryConflictError);
    expect(error.message).toContain(previous);
    expect(error.message).toContain(current);
    expect(fs.lstatSync(previous).isDirectory()).toBe(true);
    expect(names(previous)).toEqual(["g-1.json"]);
    expect(names(current)).toEqual(["g-2.json"]);
  });

  it("lets the previous path commit through the symlink, as 0.8.0 does", async () => {
    fs.mkdirSync(previous, { recursive: true });
    const directory = await Effect.runPromise(provide(ledgerDirectory));
    expect(fs.existsSync(previous)).toBe(true);

    const committed = await Effect.runPromise(
      provide(
        Effect.gen(function* () {
          const ledger = yield* Ledger;
          return yield* ledger.modify((state) =>
            Effect.succeed({ state: { ...state, leases: [lease] }, value: 0 }),
          );
        }).pipe(Effect.provide(Ledger.layer(previous))),
      ),
    );
    expect(committed.wrote).toBe(true);
    expect(names(current)).toEqual(["g-1.json"]);
    expect(fs.readdirSync(current).filter((name) => name.startsWith("tmp-"))).toEqual([]);

    const seen = await Effect.runPromise(
      provide(
        Effect.gen(function* () {
          return yield* (yield* Ledger).read;
        }).pipe(Effect.provide(Ledger.layer(directory))),
      ),
    );
    expect(seen.leases).toHaveLength(1);
  });
});
