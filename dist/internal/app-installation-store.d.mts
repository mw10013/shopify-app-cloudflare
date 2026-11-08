import { ShopDomain } from "./domain.mjs";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SQL from "@alchemy.run/cloudflare/D1/SQL";
/**
 * An `AppInstallation` row: the app installed on one shop, from the first token exchange until
 * uninstall, with every column the package's migrations create. Apps add no column here; their
 * per-shop data lives in their own tables, which cascade from this one. A row with a column a
 * later migration added still decodes: the struct ignores a property it does not name, so the
 * previous package version keeps reading the table after an expand.
 */
export declare const AppInstallation: Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  readonly scope: Schema.NullOr<Schema.String>;
  readonly accessToken: Schema.NullOr<Schema.String>;
  readonly accessTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly refreshToken: Schema.NullOr<Schema.String>;
  readonly refreshTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  /**
   * The cached plan handle. A plain string, not `PlanHandle`: every row decodes on the merchant
   * path, so a stored handle outside the catalog must read as a cache miss (`PlanCatalog.parse`),
   * never as a row that fails to decode. Null with a null deadline is never fetched; null under
   * a future deadline is a verified absence of any app subscription.
   */
  readonly planHandle: Schema.NullOr<Schema.String>;
  /** The instant the cached handle stops being fresh. */
  readonly planHandleExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  /**
   * The app subscription's boundary, cached beside the handle so a cache hit answers when it
   * expires without a second Partner call. Meaningful only while `planHandleExpiresAt` is ahead.
   */
  readonly planBoundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  /**
   * When the row was inserted: the shop's first token exchange, or its first after an uninstall
   * deleted the row. An exchange on an existing row leaves it. Null on a row inserted before the
   * column existed.
   */
  readonly installedAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
}>;
export type AppInstallation = typeof AppInstallation.Type;
/**
 * An `AppInstallation` with its tokens replaced by whether each is present. The redacted reads
 * project the tokens away in SQL, so a token never leaves D1 on this path.
 */
export declare const AppInstallationRedacted: Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  readonly scope: Schema.NullOr<Schema.String>;
  readonly accessTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly refreshTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly planHandle: Schema.NullOr<Schema.String>;
  readonly planHandleExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly planBoundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly installedAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly hasAccessToken: Schema.decodeTo<Schema.Boolean, Schema.Number, never, never>;
  readonly hasRefreshToken: Schema.decodeTo<Schema.Boolean, Schema.Number, never, never>;
}>;
export type AppInstallationRedacted = typeof AppInstallationRedacted.Type;
/** A keyset page of {@link AppInstallationRedacted} rows on `shop`. */
export interface AppInstallationRedactedPage {
  readonly appInstallations: readonly AppInstallationRedacted[];
  readonly limit: number;
  readonly startCursor: ShopDomain | null;
  readonly endCursor: ShopDomain | null;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
}
/** What `getRedactedPage` reads: a keyset page on `shop`, either way. */
export interface RedactedPageInput {
  readonly after?: ShopDomain | undefined;
  readonly before?: ShopDomain | undefined;
  readonly filter?: string | undefined;
  readonly limit: number;
}
declare const AppInstallationStore_base: Context.ServiceClass<AppInstallationStore, "app/AppInstallationStore", {
  find: (shop: string & import("effect/Brand").Brand<"ShopDomain">) => Effect.Effect<Option.Option<{
    readonly shop: string & import("effect/Brand").Brand<"ShopDomain">;
    readonly shopGid: string & import("effect/Brand").Brand<"ShopGid">;
    readonly scope: string | null;
    readonly accessToken: string | null;
    readonly accessTokenExpiresAt: DateTime.Utc | null;
    readonly refreshToken: string | null;
    readonly refreshTokenExpiresAt: DateTime.Utc | null;
    readonly planHandle: string | null;
    readonly planHandleExpiresAt: DateTime.Utc | null;
    readonly planBoundaryAt: DateTime.Utc | null;
    readonly installedAt: DateTime.Utc | null;
  }>, never, never>;
  upsert: (installation: {
    readonly shop: string & import("effect/Brand").Brand<"ShopDomain">;
    readonly shopGid: string & import("effect/Brand").Brand<"ShopGid">;
    readonly scope: string | null;
    readonly accessToken: string | null;
    readonly accessTokenExpiresAt: DateTime.Utc | null;
    readonly refreshToken: string | null;
    readonly refreshTokenExpiresAt: DateTime.Utc | null;
  }) => Effect.Effect<void, never, never>;
  updateTokens: (shop: string & import("effect/Brand").Brand<"ShopDomain">, tokens: {
    readonly accessToken: string | null;
    readonly accessTokenExpiresAt: DateTime.Utc | null;
    readonly refreshToken: string | null;
    readonly refreshTokenExpiresAt: DateTime.Utc | null;
  }) => Effect.Effect<boolean, never, never>;
  updateScope: (shop: string & import("effect/Brand").Brand<"ShopDomain">, scope: string | null) => Effect.Effect<void, never, never>;
  delete: (shop: string & import("effect/Brand").Brand<"ShopDomain">) => Effect.Effect<void, never, never>;
  updatePlan: (input: {
    readonly shop: string & import("effect/Brand").Brand<"ShopDomain">;
    readonly planHandle: string | null;
    readonly planHandleExpiresAt: DateTime.Utc | null;
    readonly planBoundaryAt: DateTime.Utc | null;
  }) => Effect.Effect<void, never, never>;
  shortenPlanExpiry: (input: {
    readonly shop: ShopDomain;
    readonly expiresAt: DateTime.Utc;
  }) => Effect.Effect<void, never, never>;
  listShopsWithStalePlan: (now: DateTime.Utc) => Effect.Effect<(string & import("effect/Brand").Brand<"ShopDomain">)[], never, never>;
  findRedacted: (shop: string & import("effect/Brand").Brand<"ShopDomain">) => Effect.Effect<Option.Option<{
    readonly shop: string & import("effect/Brand").Brand<"ShopDomain">;
    readonly shopGid: string & import("effect/Brand").Brand<"ShopGid">;
    readonly scope: string | null;
    readonly accessTokenExpiresAt: DateTime.Utc | null;
    readonly refreshTokenExpiresAt: DateTime.Utc | null;
    readonly planHandle: string | null;
    readonly planHandleExpiresAt: DateTime.Utc | null;
    readonly planBoundaryAt: DateTime.Utc | null;
    readonly installedAt: DateTime.Utc | null;
    readonly hasAccessToken: boolean;
    readonly hasRefreshToken: boolean;
  }>, never, never>;
  getRedactedPage: (input: RedactedPageInput) => Effect.Effect<AppInstallationRedactedPage, never, never>;
  shops: () => Effect.Effect<(string & import("effect/Brand").Brand<"ShopDomain">)[], never, never>;
}>;
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
export declare class AppInstallationStore extends AppInstallationStore_base {
  /** Over the D1 database it is handed: the Backend's bound database, or `D1Test`'s. */
  static readonly layerD1: <R>(database: SQL.D1DatabaseSource<never, R>) => Layer.Layer<AppInstallationStore, never, never>;
  /**
   * The same contract over in-memory state, seeded with `seed`. Each method is one synchronous
   * step, as each SQL method is one statement.
   */
  static readonly layerMemory: (seed?: readonly AppInstallation[]) => Layer.Layer<AppInstallationStore, never, never>;
}
export {};