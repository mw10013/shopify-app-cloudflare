import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { OrganizationId } from "#dev/stores/names.ts";
import { ensure, StoreDomainTakenError } from "#dev/stores/pool-ensure.ts";
import { type OrgStore, PoolPrefix } from "#dev/stores/pool.ts";
import { ShopifyCli } from "#dev/stores/shopify-cli.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const SOURCE = { organization: OrganizationId.make("1"), prefix: PoolPrefix.make("shop-") };

const storesFile = (stores: readonly string[]) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stores-pool-"));
  directories.push(directory);
  const file = path.join(directory, "pool.json");
  fs.writeFileSync(file, `${JSON.stringify({ format: 1, stores }, null, 2)}\n`);
  return file;
};

const devStore = (name: string): OrgStore => ({
  domain: `${name}.myshopify.com`,
  name,
  type: "dev",
  plan: "basic",
});

/** A Shopify CLI over an in-memory org; `domains` overrides the domain a create returns. */
const fakeCli = (orgStores: OrgStore[], domains: Readonly<Record<string, string>> = {}) =>
  Layer.succeed(ShopifyCli, {
    listStores: () => Effect.succeed([...orgStores]),
    createDevStore: (_, name) =>
      Effect.sync(() => {
        const domain = domains[name] ?? `${name}.myshopify.com`;
        orgStores.push({ ...devStore(name), domain });
        return domain;
      }),
  });

const run = (file: string, count: number, cli: ReturnType<typeof fakeCli>) =>
  Effect.runPromise(
    ensure(file, Option.some(count), SOURCE).pipe(
      Effect.result,
      Effect.provide(Layer.merge(cli, NodeServices.layer)),
    ),
  );

const listed = (file: string): unknown =>
  (JSON.parse(fs.readFileSync(file, "utf8")) as { stores: unknown }).stores;

describe("ensure", () => {
  it("refuses a pool that lists a store twice and creates nothing", async () => {
    const file = storesFile(["shop-00", "shop-00"]);
    const orgStores = [devStore("shop-00")];
    const result = await run(file, 3, fakeCli(orgStores));
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "StateFileInvalidError" },
    });
    expect(orgStores).toHaveLength(1);
  });

  it("writes each store it creates into the pool", async () => {
    const file = storesFile(["shop-00"]);
    const result = await run(file, 3, fakeCli([devStore("shop-00")]));
    expect(result._tag).toBe("Success");
    expect(listed(file)).toEqual(["shop-00", "shop-01", "shop-02"]);
  });

  it("leaves a store with a suffixed domain out and keeps the ones made before it", async () => {
    const file = storesFile(["shop-00"]);
    const result = await run(
      file,
      3,
      fakeCli([devStore("shop-00")], {
        "shop-02": "shop-02-x7k2.myshopify.com",
      }),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { name: "shop-02", domain: "shop-02-x7k2.myshopify.com" },
    });
    if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(StoreDomainTakenError);
    expect(listed(file)).toEqual(["shop-00", "shop-01"]);
  });

  it("does not rewrite the pool file when nothing changed", async () => {
    const file = storesFile(["shop-00"]);
    const before = fs.statSync(file).ino;
    await run(file, 1, fakeCli([devStore("shop-00")]));
    expect(fs.statSync(file).ino).toBe(before);
  });
});

describe("ensure and the pool file's format", () => {
  it("starts from an empty pool when the file was never written, and writes format 1", async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "stores-pool-")),
      "stores",
      "pool.json",
    );
    directories.push(path.dirname(path.dirname(file)));
    const result = await run(file, 2, fakeCli([devStore("shop-00")]));
    expect(result._tag).toBe("Success");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      format: 1,
      stores: ["shop-00", "shop-01"],
    });
  });

  it("reads a file with no format as format 1", async () => {
    const file = storesFile(["shop-00"]);
    fs.writeFileSync(file, JSON.stringify({ stores: ["shop-00"] }));
    const result = await run(file, 2, fakeCli([devStore("shop-00")]));
    expect(result._tag).toBe("Success");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ format: 1 });
  });

  it("fails before creating or writing anything on a format it does not know", async () => {
    const file = storesFile(["shop-00"]);
    const before = JSON.stringify({ format: 2, stores: ["shop-00"] });
    fs.writeFileSync(file, before);
    const orgStores = [devStore("shop-00")];
    const result = await run(file, 3, fakeCli(orgStores));
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "UnsupportedFormatError", found: "2" },
    });
    expect(orgStores).toHaveLength(1);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});

/** A run paused inside `shopify store list`, holding the org as it was then. */
const pausedRun = (file: string, orgStores: readonly OrgStore[]) => {
  let listed!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    listed = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const snapshot = [...orgStores];
  const result = Effect.runPromise(
    ensure(file, Option.none(), SOURCE).pipe(
      Effect.result,
      Effect.provide(
        Layer.merge(
          Layer.succeed(ShopifyCli, {
            listStores: () =>
              Effect.promise(async () => {
                listed();
                await gate;
                return snapshot;
              }),
            createDevStore: () => Effect.die("a check creates nothing"),
          }),
          NodeServices.layer,
        ),
      ),
    ),
  );
  return { paused, resume, result };
};

describe("ensure beside a concurrent run", () => {
  it("keeps a store that a parallel run created after this run loaded the file", async () => {
    const file = storesFile(["shop-00"]);
    const orgStores = [devStore("shop-00")];
    const check = pausedRun(file, orgStores);
    await check.paused;
    await run(file, 2, fakeCli(orgStores));
    check.resume();
    expect(await check.result).toMatchObject({
      _tag: "Success",
      success: {
        pool: { stores: ["shop-00.myshopify.com", "shop-01.myshopify.com"] },
      },
    });
    expect(listed(file)).toEqual(["shop-00", "shop-01"]);
  });
});
