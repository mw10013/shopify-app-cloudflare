import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import {
  type AppInstallationInsert,
  AppInstallationStore,
} from "#internal/app-installation-store.ts";
import { AppInstallation, AppInstallationRedactedPage } from "#internal/app-installation.ts";
import { D1Test, type D1TestShape } from "#test/node/d1-test.ts";

import { at, millisOf, SHOP, SHOP_GID, shopDomain } from "./fixtures.ts";

const row: AppInstallation = {
  shop: SHOP,
  shopGid: SHOP_GID,
  scope: "read_orders",
  accessToken: "shpat_a",
  accessTokenExpiresAt: at(1000),
  refreshToken: "shprt_a",
  refreshTokenExpiresAt: at(2000),
  planHandle: null,
  planHandleExpiresAt: null,
  planBoundaryAt: null,
  installedAt: at(500),
};

/** {@link row} as a first mint inserts it. */
const insert: AppInstallationInsert = {
  shop: row.shop,
  shopGid: row.shopGid,
  scope: row.scope,
  accessToken: row.accessToken,
  accessTokenExpiresAt: row.accessTokenExpiresAt,
};

/** A later mint's token. */
const token = { scope: "write_orders", accessToken: "shpat_b", accessTokenExpiresAt: at(3000) };

const encodeRow = Schema.encodeSync(AppInstallation);

/** Inserts each of `rows` whole, as raw SQL. */
const seed = ({ sqlite }: D1TestShape, rows: readonly AppInstallation[]) => {
  for (const installation of rows) {
    const encoded = encodeRow(installation);
    const columns = Object.keys(encoded);
    sqlite
      .prepare(
        `insert into AppInstallation (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`,
      )
      .run(...(Object.values(encoded) as SQLInputValue[]));
  }
};

/** An app's own table, cascading from `AppInstallation` as the migration's header says to. */
const createNoteTable = ({ sqlite }: D1TestShape) => {
  sqlite.exec(`create table Note (
    id integer primary key,
    shop text not null references AppInstallation (shop) on delete cascade,
    body text not null
  )`);
  sqlite.exec(`create index NoteShopIndex on Note (shop)`);
  sqlite.prepare("insert into Note (shop, body) values (?, ?)").run(SHOP, "kept");
};

const noteCount = ({ sqlite }: D1TestShape) =>
  sqlite.prepare("select count(*) as n from Note where shop = ?").get(SHOP)?.n;

/** The real SQL on a fresh `D1Test` seeded with `rows`; `D1Test` stays in context for raw SQL. */
const layerD1 = (rows: readonly AppInstallation[]) =>
  AppInstallationStore.layerD1(D1Test.database).pipe(
    Layer.provideMerge(
      Layer.effect(
        D1Test,
        Effect.tap(D1Test.make(), (d1) =>
          Effect.sync(() => {
            seed(d1, rows);
          }),
        ),
      ),
    ),
  );

const stored = Effect.gen(function* () {
  const installations = yield* AppInstallationStore;
  return Option.getOrThrow(yield* installations.find(SHOP));
});

/** Spec cases 1–3 and the plan cache, for the SQL and for the in-memory state. */
describe.each([
  { backing: "D1", layer: layerD1 },
  { backing: "memory", layer: AppInstallationStore.layerMemory },
])("AppInstallationStore ($backing)", ({ layer }) => {
  it.effect(
    "1. updateToken on a stored row writes the token, its expiry and scope and nulls both refresh columns",
    () =>
      Effect.gen(function* () {
        const installations = yield* AppInstallationStore;
        assert.isTrue(yield* installations.updateToken(SHOP, token));
        assert.deepStrictEqual(yield* stored, {
          ...row,
          ...token,
          refreshToken: null,
          refreshTokenExpiresAt: null,
        });
      }).pipe(Effect.provide(layer([row]))),
  );

  it.effect("1. updateToken with no row answers false and creates none", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      assert.isFalse(yield* installations.updateToken(SHOP, token));
      assert.isTrue(Option.isNone(yield* installations.find(SHOP)));
    }).pipe(Effect.provide(layer([]))),
  );

  it.effect(
    "1. updateToken with a later expiry already stored answers false and changes nothing",
    () =>
      Effect.gen(function* () {
        const installations = yield* AppInstallationStore;
        assert.isFalse(
          yield* installations.updateToken(SHOP, { ...token, accessTokenExpiresAt: at(999) }),
        );
        assert.isFalse(
          yield* installations.updateToken(SHOP, { ...token, accessTokenExpiresAt: at(1000) }),
        );
        assert.deepStrictEqual(yield* stored, row);
      }).pipe(Effect.provide(layer([row]))),
  );

  it.effect(
    "2. insert inserts a new row with its plan never fetched, the refresh columns null, stamped installedAt now",
    () =>
      Effect.gen(function* () {
        const installations = yield* AppInstallationStore;
        yield* TestClock.adjust(Duration.millis(500));
        assert.isTrue(yield* installations.insert(insert));
        assert.deepStrictEqual(yield* stored, {
          ...row,
          refreshToken: null,
          refreshTokenExpiresAt: null,
        });
      }).pipe(Effect.provide(layer([]))),
  );

  it.effect("2. insert on conflict answers false and leaves the row and its plan cache", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      yield* installations.updatePlan({
        shop: SHOP,
        planHandle: "baton-pro",
        planHandleExpiresAt: at(3000),
        planBoundaryAt: at(4000),
      });
      const before = yield* stored;
      yield* TestClock.adjust(Duration.millis(9000));
      assert.isFalse(
        yield* installations.insert({ ...insert, accessToken: "shpat_c", scope: "write_orders" }),
      );
      assert.deepStrictEqual(yield* stored, before);
      assert.deepStrictEqual(yield* installations.shops(), [SHOP]);
    }).pipe(Effect.provide(layer([row]))),
  );

  it.effect("3. delete removes the row, and again is a no-op", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      yield* installations.delete(SHOP);
      yield* installations.delete(SHOP);
      assert.isTrue(Option.isNone(yield* installations.find(SHOP)));
      assert.deepStrictEqual(yield* installations.shops(), []);
    }).pipe(Effect.provide(layer([row]))),
  );

  it.effect("updateScope rewrites scope alone", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      yield* installations.updateScope(SHOP, "read_orders,write_orders");
      assert.deepStrictEqual(yield* stored, { ...row, scope: "read_orders,write_orders" });
    }).pipe(Effect.provide(layer([row]))),
  );

  it.effect("updatePlan rewrites only the plan cache columns", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      yield* installations.updatePlan({
        shop: SHOP,
        planHandle: "baton-pro",
        planHandleExpiresAt: at(3000),
        planBoundaryAt: null,
      });
      assert.deepStrictEqual(yield* stored, {
        ...row,
        planHandle: "baton-pro",
        planHandleExpiresAt: at(3000),
      });
    }).pipe(Effect.provide(layer([row]))),
  );

  it.effect(
    "shortenPlanExpiry shortens the deadline, never extends it, never writes a never-fetched row",
    () =>
      Effect.gen(function* () {
        const installations = yield* AppInstallationStore;
        const deadline = Effect.map(stored, (installation) =>
          millisOf(installation.planHandleExpiresAt),
        );
        yield* installations.shortenPlanExpiry({ shop: SHOP, expiresAt: at(500) });
        assert.isNull(yield* deadline);
        yield* installations.updatePlan({
          shop: SHOP,
          planHandle: "baton-pro",
          planHandleExpiresAt: at(3000),
          planBoundaryAt: null,
        });
        yield* installations.shortenPlanExpiry({ shop: SHOP, expiresAt: at(4000) });
        assert.strictEqual(yield* deadline, 3000);
        yield* installations.shortenPlanExpiry({ shop: SHOP, expiresAt: at(2000) });
        assert.strictEqual(yield* deadline, 2000);
      }).pipe(Effect.provide(layer([row]))),
  );

  it.effect("listShopsWithStalePlan lists never-fetched and expired rows, in shop order", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      const fresh = shopDomain("fresh.myshopify.com");
      const expired = shopDomain("expired.myshopify.com");
      yield* installations.insert({ ...insert, shop: fresh });
      yield* installations.insert({ ...insert, shop: expired });
      yield* installations.updatePlan({
        shop: fresh,
        planHandle: "baton-pro",
        planHandleExpiresAt: at(2001),
        planBoundaryAt: null,
      });
      yield* installations.updatePlan({
        shop: expired,
        planHandle: "baton-pro",
        planHandleExpiresAt: at(2000),
        planBoundaryAt: null,
      });
      assert.deepStrictEqual(yield* installations.listShopsWithStalePlan(at(2000)), [
        expired,
        SHOP,
      ]);
    }).pipe(Effect.provide(layer([row]))),
  );

  it.effect("the redacted reads answer whether each token is present, never the token", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      const other = shopDomain("other.myshopify.com");
      yield* installations.insert({ ...insert, shop: other, accessToken: null });
      const found = Option.getOrThrow(yield* installations.findRedacted(other));
      assert.isFalse(found.hasAccessToken);
      assert.isFalse(found.hasRefreshToken);
      assert.isTrue(Option.getOrThrow(yield* installations.findRedacted(SHOP)).hasRefreshToken);
      assert.notProperty(found, "accessToken");
      assert.notProperty(found, "refreshToken");
      assert.isTrue(
        Option.isNone(yield* installations.findRedacted(shopDomain("none.myshopify.com"))),
      );
      const page = yield* installations.getRedactedPage({ limit: 1 });
      assert.deepStrictEqual(
        page.appInstallations.map((s) => s.shop),
        [other],
      );
      assert.isTrue(page.hasNextPage);
      const next = yield* installations.getRedactedPage({ limit: 1, after: other });
      assert.deepStrictEqual(
        next.appInstallations.map((s) => s.shop),
        [SHOP],
      );
      assert.isFalse(next.hasNextPage);
      assert.isTrue(next.hasPreviousPage);
      const back = yield* installations.getRedactedPage({ limit: 1, before: SHOP });
      assert.deepStrictEqual(
        back.appInstallations.map((s) => s.shop),
        [other],
      );
      const filtered = yield* installations.getRedactedPage({ limit: 10, filter: "seed" });
      assert.deepStrictEqual(
        filtered.appInstallations.map((s) => s.shop),
        [SHOP],
      );
    }).pipe(Effect.provide(layer([row]))),
  );

  it.effect("a redacted page crosses a binding through the /contract schema unchanged", () =>
    Effect.gen(function* () {
      const installations = yield* AppInstallationStore;
      const page = yield* installations.getRedactedPage({ limit: 10 });
      assert.isNotEmpty(page.appInstallations);
      const encoded = Schema.encodeSync(AppInstallationRedactedPage)(page);
      assert.notInclude(JSON.stringify(encoded), "shpat_");
      assert.deepStrictEqual(
        Schema.decodeUnknownSync(AppInstallationRedactedPage)(structuredClone(encoded)),
        page,
      );
    }).pipe(Effect.provide(layer([row]))),
  );
});

describe("AppInstallationStore over D1", () => {
  it.effect("D1Test enforces foreign keys, as D1 always does", () =>
    Effect.gen(function* () {
      const { sqlite } = yield* D1Test;
      assert.deepStrictEqual(sqlite.prepare("pragma foreign_keys").get(), { foreign_keys: 1 });
    }).pipe(Effect.provide(layerD1([]))),
  );

  it.effect("N6. insert on an installed shop leaves the plan cache and the app's child rows", () =>
    Effect.gen(function* () {
      const d1 = yield* D1Test;
      const installations = yield* AppInstallationStore;
      createNoteTable(d1);
      yield* installations.updatePlan({
        shop: SHOP,
        planHandle: "baton-pro",
        planHandleExpiresAt: at(3000),
        planBoundaryAt: at(4000),
      });
      assert.isFalse(yield* installations.insert({ ...insert, accessToken: "shpat_c" }));
      assert.strictEqual(noteCount(d1), 1);
      const after = yield* stored;
      assert.strictEqual(after.planHandle, "baton-pro");
      assert.strictEqual(millisOf(after.planHandleExpiresAt), 3000);
      assert.strictEqual(millisOf(after.planBoundaryAt), 4000);
    }).pipe(Effect.provide(layerD1([row]))),
  );

  it("N6. the store never writes with insert or replace, which deletes and so cascades", () => {
    const source = readFileSync(
      new URL("../src/internal/app-installation-store.ts", import.meta.url),
      "utf8",
    ).replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
    assert.notMatch(source, /\b(?:insert\s+or\s+replace|replace\s+into)\b/iu);
  });

  it.effect("cascade: deleting the installation deletes the app's rows that reference it", () =>
    Effect.gen(function* () {
      const d1 = yield* D1Test;
      const installations = yield* AppInstallationStore;
      createNoteTable(d1);
      yield* installations.delete(SHOP);
      assert.strictEqual(noteCount(d1), 0);
      assert.throws(
        () => d1.sqlite.prepare("insert into Note (shop, body) values (?, ?)").run(SHOP, "orphan"),
        /FOREIGN KEY/u,
      );
    }).pipe(Effect.provide(layerD1([row]))),
  );

  it.effect("N7. a row with a column a later migration added still decodes", () =>
    Effect.gen(function* () {
      const { sqlite } = yield* D1Test;
      sqlite.exec("alter table AppInstallation add column addedLater text default 'x'");
      assert.deepStrictEqual(yield* stored, row);
      const installations = yield* AppInstallationStore;
      yield* installations.insert({ ...insert, shop: shopDomain("new.myshopify.com") });
      assert.deepStrictEqual(
        sqlite
          .prepare("select addedLater from AppInstallation where shop = ?")
          .get("new.myshopify.com"),
        { addedLater: "x" },
      );
    }).pipe(Effect.provide(layerD1([row]))),
  );

  it.effect("a row that does not decode is a defect", () =>
    Effect.gen(function* () {
      const { sqlite } = yield* D1Test;
      sqlite.prepare("update AppInstallation set shopGid = '' where shop = ?").run(SHOP);
      const installations = yield* AppInstallationStore;
      const exit = yield* Effect.exit(installations.find(SHOP));
      assert.isTrue(
        Exit.isFailure(exit) && Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause),
      );
    }).pipe(Effect.provide(layerD1([row]))),
  );
});
