import { AppInstallation } from "./app-installation.mjs";
import { ShopDomain } from "./domain.mjs";
import "effect/Schema";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SQL from "@alchemy.run/cloudflare/D1/SQL";
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
  getRedactedPage: (input: RedactedPageInput) => Effect.Effect<{
    readonly appInstallations: readonly {
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
    }[];
    readonly limit: number;
    readonly startCursor: (string & import("effect/Brand").Brand<"ShopDomain">) | null;
    readonly endCursor: (string & import("effect/Brand").Brand<"ShopDomain">) | null;
    readonly hasPreviousPage: boolean;
    readonly hasNextPage: boolean;
  }, never, never>;
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