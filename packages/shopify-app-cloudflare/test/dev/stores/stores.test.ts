import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { adminUrlOf, storeNameOf, storeOf } from "#dev/stores.ts";

let scratch: string;
let appRoot: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stores-api-")));
  appRoot = path.join(scratch, "app");
  fs.mkdirSync(appRoot);
  fs.writeFileSync(path.join(appRoot, "shopify.app.toml"), 'handle = "my-dev-app"\n');
  fs.writeFileSync(path.join(appRoot, "shopify.app.staging.toml"), 'handle = "my-staging-app"\n');
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const writePool = (stores: readonly string[]) => {
  const file = path.join(scratch, "state", "shopify-app-cloudflare", "stores", "pool.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ format: 1, stores }));
};

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.merge(
          NodeServices.layer,
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { XDG_STATE_HOME: path.join(scratch, "state") } }),
          ),
        ),
      ),
    ),
  );

const app = () => ({ root: appRoot, name: "my-app" });

describe("storeOf", () => {
  it("uses the stage's one store for staging and production, with no ledger", async () => {
    expect(await run(storeOf("staging", app()))).toEqual({
      store: "mw10013-staging-shop-00",
      config: "shopify.app.staging.toml",
    });
    expect((await run(storeOf("production", app()))).store).toBe(storeNameOf("production", 0));
    expect(fs.existsSync(path.join(scratch, "state"))).toBe(false);
  });

  it("leases dev and e2e their own pool stores, and the same one again", async () => {
    writePool(["mw10013-pool-03", "mw10013-pool-04"]);
    const dev = await run(storeOf("dev", app()));
    const e2e = await run(storeOf("e2e", app()));
    expect(dev).toEqual({ store: "mw10013-pool-03", config: "shopify.app.toml" });
    expect(e2e).toEqual({ store: "mw10013-pool-04", config: "shopify.app.e2e.toml" });
    expect(await run(storeOf("dev", app()))).toEqual(dev);
  });

  it("keys the lease by machine, the app's real path and the environment, as berth does", async () => {
    writePool(["mw10013-pool-03"]);
    const link = path.join(scratch, "link");
    fs.symlinkSync(appRoot, link);
    await run(storeOf("dev", { root: link, name: "my-app" }));
    const ledger = path.join(scratch, "state", "shopify-app-cloudflare", "stores", "ledger");
    const [generation] = fs.readdirSync(ledger);
    const written = JSON.parse(fs.readFileSync(path.join(ledger, generation ?? ""), "utf8")) as {
      readonly format: number;
      readonly leases: readonly { readonly key: unknown; readonly project: string }[];
    };
    expect(written.format).toBe(1);
    expect(written.leases).toMatchObject([
      {
        key: { machine: os.hostname().replace(/\.local$/u, ""), checkout: appRoot, env: "dev" },
        project: "my-app",
      },
    ]);
  });

  it("fails when the pool is empty, saying to ensure it", async () => {
    const error = await run(Effect.flip(storeOf("dev", app())));
    expect(error).toMatchObject({ _tag: "StorePoolExhaustedError", stores: 0 });
    expect(error.message).toContain("stores pool ensure");
  });
});

describe("adminUrlOf", () => {
  it("reads the handle from the environment's toml", async () => {
    expect(await run(adminUrlOf("staging", "app", app()))).toBe(
      "https://admin.shopify.com/store/mw10013-staging-shop-00/apps/my-staging-app/app",
    );
    writePool(["mw10013-pool-03"]);
    expect(await run(adminUrlOf("dev", "pricing", app()))).toBe(
      "https://admin.shopify.com/store/mw10013-pool-03/apps/my-dev-app/pricing",
    );
  });

  it("fails naming the toml when the environment has none", async () => {
    const error = await run(Effect.flip(adminUrlOf("production", "app", app())));
    expect(error).toMatchObject({ _tag: "AppHandleError" });
    expect(error.message).toContain("shopify.app.production.toml");
  });
});
