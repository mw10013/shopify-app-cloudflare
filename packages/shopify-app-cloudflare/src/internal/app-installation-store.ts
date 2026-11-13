import * as SQL from "@alchemy.run/cloudflare/D1/SQL";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as Struct from "effect/Struct";

import {
  AppInstallation,
  AppInstallationRedacted,
  type AppInstallationRedactedPage,
} from "./app-installation.ts";
import { ShopDomain } from "./domain.ts";

const SqliteBoolean = Schema.Number.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((n) => n === 1),
    encode: SchemaGetter.transform((b) => (b ? 1 : 0)),
  }),
);

export const AppInstallationInsert = Schema.Struct(
  Struct.pick(AppInstallation.fields, [
    "shop",
    "shopGid",
    "scope",
    "accessToken",
    "accessTokenExpiresAt",
  ]),
);
export type AppInstallationInsert = typeof AppInstallationInsert.Type;

export const AppInstallationToken = Schema.Struct({
  scope: Schema.String,
  accessToken: Schema.String,
  accessTokenExpiresAt: Schema.DateTimeUtcFromMillis,
});
export type AppInstallationToken = typeof AppInstallationToken.Type;

export const AppInstallationPlan = Schema.Struct(
  Struct.pick(AppInstallation.fields, [
    "shop",
    "planHandle",
    "planHandleExpiresAt",
    "planBoundaryAt",
  ]),
);
export type AppInstallationPlan = typeof AppInstallationPlan.Type;

const RedactedRow = Schema.Struct({
  ...AppInstallationRedacted.fields,
  hasAccessToken: SqliteBoolean,
});

/** What `getRedactedPage` reads: a keyset page on `shop`, either way. */
export interface RedactedPageInput {
  readonly after?: ShopDomain | undefined;
  readonly before?: ShopDomain | undefined;
  readonly filter?: string | undefined;
  readonly limit: number;
}

const encodeInsert = Schema.encodeEffect(AppInstallationInsert);
const encodeToken = Schema.encodeEffect(AppInstallationToken);
const encodePlan = Schema.encodeEffect(AppInstallationPlan);

const decodeShops = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ shop: ShopDomain })));

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(AppInstallation));

const decodeRedactedRows = Schema.decodeUnknownEffect(Schema.Array(RedactedRow));

const redactedPage = (
  fetched: readonly AppInstallationRedacted[],
  { after, before, limit }: RedactedPageInput,
): AppInstallationRedactedPage => {
  const overflow = fetched.length > limit;
  const appInstallations =
    before === undefined ? fetched.slice(0, limit) : fetched.slice(0, limit).toReversed();
  return {
    appInstallations,
    limit,
    startCursor: appInstallations[0]?.shop ?? null,
    endCursor: appInstallations.at(-1)?.shop ?? null,
    hasPreviousPage:
      before === undefined ? after !== undefined && appInstallations.length > 0 : overflow,
    hasNextPage: before === undefined ? overflow : appInstallations.length > 0,
  };
};

const make = <R>(database: SQL.D1DatabaseSource<never, R>) =>
  Effect.gen(function* () {
    const sql = yield* SQL.D1(database);

    const find = Effect.fn("AppInstallationStore.find")(function* (shop: ShopDomain) {
      const [row] = yield* decodeRows(
        yield* sql`select * from AppInstallation where shop = ${shop}`,
      );
      return Option.fromUndefinedOr(row);
    }, Effect.orDie);

    /**
     * A first mint's write: `insert … on conflict do nothing`, never `insert or replace`, which is
     * a delete and would cascade into every app table. Answers whether it inserted; two first
     * mints at once leave one row.
     */
    const insert = Effect.fn("AppInstallationStore.insert")(function* (
      installation: AppInstallationInsert,
    ) {
      const row = yield* encodeInsert(installation);
      const installedAt = DateTime.toEpochMillis(yield* DateTime.now);
      const inserted = yield* decodeShops(
        yield* sql`insert into AppInstallation (shop, shopGid, scope, accessToken, accessTokenExpiresAt, installedAt)
      values (${row.shop}, ${row.shopGid}, ${row.scope}, ${row.accessToken}, ${row.accessTokenExpiresAt}, ${installedAt})
      on conflict (shop) do nothing
      returning shop`,
      );
      return inserted.length > 0;
    }, Effect.orDie);

    const updateToken = Effect.fn("AppInstallationStore.updateToken")(function* (
      shop: ShopDomain,
      token: AppInstallationToken,
      replacing: string | null = null,
    ) {
      const encoded = yield* encodeToken(token);
      const updated = yield* decodeShops(
        yield* sql`update AppInstallation set
        scope = ${encoded.scope},
        accessToken = ${encoded.accessToken},
        accessTokenExpiresAt = ${encoded.accessTokenExpiresAt}
      where shop = ${shop} and (accessTokenExpiresAt is null or accessTokenExpiresAt < ${encoded.accessTokenExpiresAt} or accessToken = ${replacing})
      returning shop`,
      );
      return updated.length > 0;
    }, Effect.orDie);

    const updateScope = Effect.fn("AppInstallationStore.updateScope")(function* (
      shop: ShopDomain,
      scope: string | null,
    ) {
      yield* sql`update AppInstallation set scope = ${scope} where shop = ${shop}`;
    }, Effect.orDie);

    const deleteInstallation = Effect.fn("AppInstallationStore.delete")(function* (
      shop: ShopDomain,
    ) {
      yield* sql`delete from AppInstallation where shop = ${shop}`;
    }, Effect.orDie);

    const updatePlan = Effect.fn("AppInstallationStore.updatePlan")(function* (
      input: AppInstallationPlan,
    ) {
      const plan = yield* encodePlan(input);
      yield* sql`update AppInstallation set
        planHandle = ${plan.planHandle},
        planHandleExpiresAt = ${plan.planHandleExpiresAt},
        planBoundaryAt = ${plan.planBoundaryAt}
      where shop = ${plan.shop}`;
    }, Effect.orDie);

    const shortenPlanExpiry = Effect.fn("AppInstallationStore.shortenPlanExpiry")(
      function* (input: { readonly shop: ShopDomain; readonly expiresAt: DateTime.Utc }) {
        yield* sql`update AppInstallation
        set planHandleExpiresAt = min(planHandleExpiresAt, ${DateTime.toEpochMillis(input.expiresAt)})
        where shop = ${input.shop} and planHandleExpiresAt is not null`;
      },
      Effect.orDie,
    );

    const listShopsWithStalePlan = Effect.fn("AppInstallationStore.listShopsWithStalePlan")(
      function* (now: DateTime.Utc) {
        const rows = yield* decodeShops(
          yield* sql`select shop from AppInstallation
            where planHandleExpiresAt is null or planHandleExpiresAt <= ${DateTime.toEpochMillis(now)}
            order by shop`,
        );
        return rows.map(({ shop }) => shop);
      },
      Effect.orDie,
    );

    const findRedacted = Effect.fn("AppInstallationStore.findRedacted")(function* (
      shop: ShopDomain,
    ) {
      const [row] = yield* decodeRedactedRows(
        yield* sql`select shop, shopGid, scope, accessTokenExpiresAt,
            planHandle, planHandleExpiresAt, planBoundaryAt, installedAt,
            (accessToken is not null) as hasAccessToken
          from AppInstallation
          where shop = ${shop}`,
      );
      return Option.fromUndefinedOr(row);
    }, Effect.orDie);

    /**
     * The cursor clause is present only when a cursor is: a `(? is null or shop > ?)` disjunction
     * defeats SQLite's primary-key seek. The filter is a bound contains-`like`, so `%` and `_` in
     * it act as wildcards.
     */
    const getRedactedPage = Effect.fn("AppInstallationStore.getRedactedPage")(function* (
      input: RedactedPageInput,
    ) {
      const cursor = input.before ?? input.after;
      const compare = sql.literal(input.before === undefined ? ">" : "<");
      const clauses = [
        ...(cursor === undefined ? [] : [sql`shop ${compare} ${cursor}`]),
        ...(input.filter ? [sql`shop like ${`%${input.filter}%`}`] : []),
      ];
      const fetched = yield* decodeRedactedRows(
        yield* sql`select shop, shopGid, scope, accessTokenExpiresAt,
            planHandle, planHandleExpiresAt, planBoundaryAt, installedAt,
            (accessToken is not null) as hasAccessToken
          from AppInstallation
          ${clauses.length > 0 ? sql`where ${sql.and(clauses)}` : sql``}
          order by shop ${sql.literal(input.before === undefined ? "asc" : "desc")}
          limit ${input.limit + 1}`,
      );
      return redactedPage(fetched, input);
    }, Effect.orDie);

    const shops = Effect.fn("AppInstallationStore.shops")(function* () {
      const rows = yield* decodeShops(yield* sql`select shop from AppInstallation order by shop`);
      return rows.map(({ shop }) => shop);
    }, Effect.orDie);

    return {
      find,
      insert,
      updateToken,
      updateScope,
      delete: deleteInstallation,
      updatePlan,
      shortenPlanExpiry,
      listShopsWithStalePlan,
      findRedacted,
      getRedactedPage,
      shops,
    };
  });

const redact = ({ accessToken, ...row }: AppInstallation): AppInstallationRedacted => ({
  ...row,
  hasAccessToken: accessToken !== null,
});

export class AppInstallationStore extends Context.Service<
  AppInstallationStore,
  Effect.Success<ReturnType<typeof make<never>>>
>()("app/AppInstallationStore") {
  static readonly layerD1 = <R>(database: SQL.D1DatabaseSource<never, R>) =>
    Layer.effect(AppInstallationStore, make(database));

  static readonly layerMemory = (seed: readonly AppInstallation[] = []) =>
    Layer.sync(AppInstallationStore, () => {
      const rows = new Map(seed.map((row) => [row.shop, row]));
      const edit = (shop: ShopDomain, change: Partial<AppInstallation>) =>
        Effect.sync(() => {
          const row = rows.get(shop);
          if (row !== undefined) rows.set(shop, { ...row, ...change });
        });
      const sorted = () => [...rows.values()].toSorted((a, b) => a.shop.localeCompare(b.shop));
      return {
        find: (shop: ShopDomain) => Effect.sync(() => Option.fromUndefinedOr(rows.get(shop))),
        insert: (installation: AppInstallationInsert) =>
          Effect.map(DateTime.now, (installedAt) => {
            if (rows.has(installation.shop)) return false;
            rows.set(installation.shop, {
              ...installation,
              planHandle: null,
              planHandleExpiresAt: null,
              planBoundaryAt: null,
              installedAt,
            });
            return true;
          }),
        updateToken: (
          shop: ShopDomain,
          token: AppInstallationToken,
          replacing: string | null = null,
        ) =>
          Effect.sync(() => {
            const row = rows.get(shop);
            if (
              row === undefined ||
              (row.accessTokenExpiresAt !== null &&
                row.accessToken !== replacing &&
                !DateTime.isLessThan(row.accessTokenExpiresAt, token.accessTokenExpiresAt))
            )
              return false;
            rows.set(shop, { ...row, ...token });
            return true;
          }),
        updateScope: (shop: ShopDomain, scope: string | null) => edit(shop, { scope }),
        delete: (shop: ShopDomain) =>
          Effect.sync(() => {
            rows.delete(shop);
          }),
        updatePlan: ({ shop, ...plan }: AppInstallationPlan) => edit(shop, plan),
        shortenPlanExpiry: ({
          shop,
          expiresAt,
        }: {
          readonly shop: ShopDomain;
          readonly expiresAt: DateTime.Utc;
        }) =>
          Effect.sync(() => {
            const row = rows.get(shop);
            if (row !== undefined && row.planHandleExpiresAt !== null)
              rows.set(shop, {
                ...row,
                planHandleExpiresAt: DateTime.min(row.planHandleExpiresAt, expiresAt),
              });
          }),
        listShopsWithStalePlan: (now: DateTime.Utc) =>
          Effect.sync(() =>
            sorted()
              .filter(
                (row) =>
                  row.planHandleExpiresAt === null ||
                  DateTime.isLessThanOrEqualTo(row.planHandleExpiresAt, now),
              )
              .map((row) => row.shop),
          ),
        findRedacted: (shop: ShopDomain) =>
          Effect.sync(() => Option.map(Option.fromUndefinedOr(rows.get(shop)), redact)),
        getRedactedPage: (input: RedactedPageInput) =>
          Effect.sync(() => {
            const matching = sorted().filter(
              (row) => input.filter === undefined || row.shop.includes(input.filter),
            );
            const { after, before } = input;
            const fetched =
              before === undefined
                ? matching.filter((row) => after === undefined || row.shop > after)
                : matching.filter((row) => row.shop < before).toReversed();
            return redactedPage(fetched.slice(0, input.limit + 1).map(redact), input);
          }),
        shops: () => Effect.sync(() => sorted().map((row) => row.shop)),
      };
    });
}
