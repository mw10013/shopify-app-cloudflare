import { ShopDomain, ShopGid } from "./domain.mjs";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SQL from "@alchemy.run/cloudflare/D1/SQL";
import * as SchemaGetter from "effect/SchemaGetter";
import * as Struct from "effect/Struct";
// src/internal/app-installation-store.ts
/**
* The `AppInstallation` table: its row schemas and the only code that reads or writes it.
*
* @module
*/
/** An instant as an `AppInstallation` column stores it: epoch milliseconds, null when unset. */
const StoredInstant = Schema.NullOr(Schema.DateTimeUtcFromMillis);
/** A SQLite boolean: the 1 or 0 a comparison such as `accessToken is not null` answers. */
const SqliteBoolean = Schema.Number.pipe(Schema.decodeTo(Schema.Boolean, {
	decode: SchemaGetter.transform((n) => n === 1),
	encode: SchemaGetter.transform((b) => b ? 1 : 0)
}));
/**
* An `AppInstallation` row: the app installed on one shop, from the first token exchange until
* uninstall, with every column the package's migrations create. Apps add no column here; their
* per-shop data lives in their own tables, which cascade from this one. A row with a column a
* later migration added still decodes: the struct ignores a property it does not name, so the
* previous package version keeps reading the table after an expand.
*/
const AppInstallation = Schema.Struct({
	shop: ShopDomain,
	shopGid: ShopGid,
	scope: Schema.NullOr(Schema.String),
	accessToken: Schema.NullOr(Schema.String),
	accessTokenExpiresAt: StoredInstant,
	refreshToken: Schema.NullOr(Schema.String),
	refreshTokenExpiresAt: StoredInstant,
	/**
	* The cached plan handle. A plain string, not `PlanHandle`: every row decodes on the merchant
	* path, so a stored handle outside the catalog must read as a cache miss (`PlanCatalog.parse`),
	* never as a row that fails to decode. Null with a null deadline is never fetched; null under
	* a future deadline is a verified absence of any app subscription.
	*/
	planHandle: Schema.NullOr(Schema.String),
	/** The instant the cached handle stops being fresh. */
	planHandleExpiresAt: StoredInstant,
	/**
	* The app subscription's boundary, cached beside the handle so a cache hit answers when it
	* expires without a second Partner call. Meaningful only while `planHandleExpiresAt` is ahead.
	*/
	planBoundaryAt: StoredInstant,
	/**
	* When the row was inserted: the shop's first token exchange, or its first after an uninstall
	* deleted the row. An exchange on an existing row leaves it. Null on a row inserted before the
	* column existed.
	*/
	installedAt: StoredInstant
});
/**
* An `AppInstallation` as a token exchange writes it: everything but the plan columns, so an
* exchange never disturbs a cached plan, and a fresh insert leaves them null (never fetched).
* Nor `installedAt`, which the insert stamps with the current time.
*/
const AppInstallationUpsert = Schema.Struct(Struct.omit(AppInstallation.fields, [
	"planHandle",
	"planHandleExpiresAt",
	"planBoundaryAt",
	"installedAt"
]));
/** The four token columns a refresh rewrites. */
const AppInstallationTokens = Schema.Struct(Struct.pick(AppInstallation.fields, [
	"accessToken",
	"accessTokenExpiresAt",
	"refreshToken",
	"refreshTokenExpiresAt"
]));
/** The three plan cache columns, by shop. */
const AppInstallationPlan = Schema.Struct(Struct.pick(AppInstallation.fields, [
	"shop",
	"planHandle",
	"planHandleExpiresAt",
	"planBoundaryAt"
]));
/**
* An `AppInstallation` with its tokens replaced by whether each is present. The redacted reads
* project the tokens away in SQL, so a token never leaves D1 on this path.
*/
const AppInstallationRedacted = Schema.Struct({
	...Struct.omit(AppInstallation.fields, ["accessToken", "refreshToken"]),
	hasAccessToken: SqliteBoolean,
	hasRefreshToken: SqliteBoolean
});
const encodeUpsert = Schema.encodeEffect(AppInstallationUpsert);
const encodeTokens = Schema.encodeEffect(AppInstallationTokens);
const encodePlan = Schema.encodeEffect(AppInstallationPlan);
/** What a `select shop` or an `update … returning shop` answers. */
const decodeShops = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ shop: ShopDomain })));
/** Rows of the table. A row that does not decode is a broken invariant, so it dies. */
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(AppInstallation));
const decodeRedactedRows = Schema.decodeUnknownEffect(Schema.Array(AppInstallationRedacted));
/**
* Cuts a read of `limit + 1` rows, in the read's own order, into a page: the extra row only says
* another page exists that way. A backward read (`before`) came newest first, so its page is
* reversed back into `shop` order.
*/
const redactedPage = (fetched, { after, before, limit }) => {
	const overflow = fetched.length > limit;
	const appInstallations = before === void 0 ? fetched.slice(0, limit) : fetched.slice(0, limit).toReversed();
	return {
		appInstallations,
		limit,
		startCursor: appInstallations[0]?.shop ?? null,
		endCursor: appInstallations.at(-1)?.shop ?? null,
		hasPreviousPage: before === void 0 ? after !== void 0 && appInstallations.length > 0 : overflow,
		hasNextPage: before === void 0 ? overflow : appInstallations.length > 0
	};
};
const make = (database) => Effect.gen(function* () {
	const sql = yield* SQL.D1(database);
	return {
		find: Effect.fn("AppInstallationStore.find")(function* (shop) {
			const [row] = yield* decodeRows(yield* sql`select * from AppInstallation where shop = ${shop}`);
			return Option.fromUndefinedOr(row);
		}, Effect.orDie),
		upsert: Effect.fn("AppInstallationStore.upsert")(function* (installation) {
			const row = yield* encodeUpsert(installation);
			const installedAt = DateTime.toEpochMillis(yield* DateTime.now);
			yield* sql`insert into AppInstallation (shop, shopGid, scope, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, installedAt)
      values (${row.shop}, ${row.shopGid}, ${row.scope}, ${row.accessToken}, ${row.accessTokenExpiresAt}, ${row.refreshToken}, ${row.refreshTokenExpiresAt}, ${installedAt})
      on conflict (shop) do update set
        shopGid = excluded.shopGid,
        scope = excluded.scope,
        accessToken = excluded.accessToken,
        accessTokenExpiresAt = excluded.accessTokenExpiresAt,
        refreshToken = excluded.refreshToken,
        refreshTokenExpiresAt = excluded.refreshTokenExpiresAt`;
		}, Effect.orDie),
		updateTokens: Effect.fn("AppInstallationStore.updateTokens")(function* (shop, tokens) {
			const encoded = yield* encodeTokens(tokens);
			return (yield* decodeShops(yield* sql`update AppInstallation set
        accessToken = ${encoded.accessToken},
        accessTokenExpiresAt = ${encoded.accessTokenExpiresAt},
        refreshToken = ${encoded.refreshToken},
        refreshTokenExpiresAt = ${encoded.refreshTokenExpiresAt}
      where shop = ${shop}
      returning shop`)).length > 0;
		}, Effect.orDie),
		updateScope: Effect.fn("AppInstallationStore.updateScope")(function* (shop, scope) {
			yield* sql`update AppInstallation set scope = ${scope} where shop = ${shop}`;
		}, Effect.orDie),
		delete: Effect.fn("AppInstallationStore.delete")(function* (shop) {
			yield* sql`delete from AppInstallation where shop = ${shop}`;
		}, Effect.orDie),
		updatePlan: Effect.fn("AppInstallationStore.updatePlan")(function* (input) {
			const plan = yield* encodePlan(input);
			yield* sql`update AppInstallation set
        planHandle = ${plan.planHandle},
        planHandleExpiresAt = ${plan.planHandleExpiresAt},
        planBoundaryAt = ${plan.planBoundaryAt}
      where shop = ${plan.shop}`;
		}, Effect.orDie),
		shortenPlanExpiry: Effect.fn("AppInstallationStore.shortenPlanExpiry")(function* (input) {
			yield* sql`update AppInstallation
        set planHandleExpiresAt = min(planHandleExpiresAt, ${DateTime.toEpochMillis(input.expiresAt)})
        where shop = ${input.shop} and planHandleExpiresAt is not null`;
		}, Effect.orDie),
		listShopsWithStalePlan: Effect.fn("AppInstallationStore.listShopsWithStalePlan")(function* (now) {
			return (yield* decodeShops(yield* sql`select shop from AppInstallation
            where planHandleExpiresAt is null or planHandleExpiresAt <= ${DateTime.toEpochMillis(now)}
            order by shop`)).map(({ shop }) => shop);
		}, Effect.orDie),
		findRedacted: Effect.fn("AppInstallationStore.findRedacted")(function* (shop) {
			const [row] = yield* decodeRedactedRows(yield* sql`select shop, shopGid, scope, accessTokenExpiresAt, refreshTokenExpiresAt,
            planHandle, planHandleExpiresAt, planBoundaryAt, installedAt,
            (accessToken is not null) as hasAccessToken,
            (refreshToken is not null) as hasRefreshToken
          from AppInstallation
          where shop = ${shop}`);
			return Option.fromUndefinedOr(row);
		}, Effect.orDie),
		getRedactedPage: Effect.fn("AppInstallationStore.getRedactedPage")(function* (input) {
			const cursor = input.before ?? input.after;
			const compare = sql.literal(input.before === void 0 ? ">" : "<");
			const clauses = [...cursor === void 0 ? [] : [sql`shop ${compare} ${cursor}`], ...input.filter ? [sql`shop like ${`%${input.filter}%`}`] : []];
			const fetched = yield* decodeRedactedRows(yield* sql`select shop, shopGid, scope, accessTokenExpiresAt, refreshTokenExpiresAt,
            planHandle, planHandleExpiresAt, planBoundaryAt, installedAt,
            (accessToken is not null) as hasAccessToken,
            (refreshToken is not null) as hasRefreshToken
          from AppInstallation
          ${clauses.length > 0 ? sql`where ${sql.and(clauses)}` : sql``}
          order by shop ${sql.literal(input.before === void 0 ? "asc" : "desc")}
          limit ${input.limit + 1}`);
			return redactedPage(fetched, input);
		}, Effect.orDie),
		shops: Effect.fn("AppInstallationStore.shops")(function* () {
			return (yield* decodeShops(yield* sql`select shop from AppInstallation order by shop`)).map(({ shop }) => shop);
		}, Effect.orDie)
	};
});
const redact = ({ accessToken, refreshToken, ...row }) => ({
	...row,
	hasAccessToken: accessToken !== null,
	hasRefreshToken: refreshToken !== null
});
/**
* The only code that touches the `AppInstallation` table. Storage errors are defects. Writers,
* by column group, so no column has two owners but `scope`, which both write as Shopify's
* current granted scopes:
*
* | Columns                                              | Writer              | Methods                            |
* | ---------------------------------------------------- | ------------------- | ---------------------------------- |
* | the row's existence, `shopGid`, `scope`, the tokens  | the shop's grantor  | `upsert`, `updateTokens`, `delete` |
* | `scope` on `app/scopes_update`                       | the webhooks        | `updateScope`                      |
* | `planHandle`, `planHandleExpiresAt`, `planBoundaryAt` | the plan check     | `updatePlan`, `shortenPlanExpiry`  |
*
* The grantor runs one grant at a time per shop and orders `upsert`, `updateTokens` and
* `delete`, so none needs a fence.
*/
var AppInstallationStore = class AppInstallationStore extends Context.Service()("app/AppInstallationStore") {
	/** Over the D1 database it is handed: the Backend's bound database, or `D1Test`'s. */
	static layerD1 = (database) => Layer.effect(AppInstallationStore, make(database));
	/**
	* The same contract over in-memory state, seeded with `seed`. Each method is one synchronous
	* step, as each SQL method is one statement.
	*/
	static layerMemory = (seed = []) => Layer.sync(AppInstallationStore, () => {
		const rows = new Map(seed.map((row) => [row.shop, row]));
		const edit = (shop, change) => Effect.sync(() => {
			const row = rows.get(shop);
			if (row !== void 0) rows.set(shop, {
				...row,
				...change
			});
		});
		const sorted = () => [...rows.values()].toSorted((a, b) => a.shop.localeCompare(b.shop));
		return {
			find: (shop) => Effect.sync(() => Option.fromUndefinedOr(rows.get(shop))),
			upsert: (installation) => Effect.map(DateTime.now, (installedAt) => {
				const existing = rows.get(installation.shop);
				rows.set(installation.shop, existing === void 0 ? {
					...installation,
					planHandle: null,
					planHandleExpiresAt: null,
					planBoundaryAt: null,
					installedAt
				} : {
					...existing,
					...installation
				});
			}),
			updateTokens: (shop, tokens) => Effect.sync(() => {
				const row = rows.get(shop);
				if (row === void 0) return false;
				rows.set(shop, {
					...row,
					...tokens
				});
				return true;
			}),
			updateScope: (shop, scope) => edit(shop, { scope }),
			delete: (shop) => Effect.sync(() => {
				rows.delete(shop);
			}),
			updatePlan: ({ shop, ...plan }) => edit(shop, plan),
			shortenPlanExpiry: ({ shop, expiresAt }) => Effect.sync(() => {
				const row = rows.get(shop);
				if (row !== void 0 && row.planHandleExpiresAt !== null) rows.set(shop, {
					...row,
					planHandleExpiresAt: DateTime.min(row.planHandleExpiresAt, expiresAt)
				});
			}),
			listShopsWithStalePlan: (now) => Effect.sync(() => sorted().filter((row) => row.planHandleExpiresAt === null || DateTime.isLessThanOrEqualTo(row.planHandleExpiresAt, now)).map((row) => row.shop)),
			findRedacted: (shop) => Effect.sync(() => Option.map(Option.fromUndefinedOr(rows.get(shop)), redact)),
			getRedactedPage: (input) => Effect.sync(() => {
				const matching = sorted().filter((row) => input.filter === void 0 || row.shop.includes(input.filter));
				const { after, before } = input;
				const fetched = before === void 0 ? matching.filter((row) => after === void 0 || row.shop > after) : matching.filter((row) => row.shop < before).toReversed();
				return redactedPage(fetched.slice(0, input.limit + 1).map(redact), input);
			}),
			shops: () => Effect.sync(() => sorted().map((row) => row.shop))
		};
	});
};
export { AppInstallation, AppInstallationPlan, AppInstallationRedacted, AppInstallationStore, AppInstallationTokens, AppInstallationUpsert };
