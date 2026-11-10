/**
 * Every store's name, the one place that spells it. A store's name is its `myshopify.com` handle,
 * and Shopify shares that namespace across all stores, so generic names are taken: `mw10013`, the
 * organization's handle, keeps ours unique.
 *
 * @module
 */
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** Shopify's numeric organization id, as `--organization-id` takes it. */
export const OrganizationId = Schema.String.check(Schema.isPattern(/^[0-9]+$/u)).pipe(
  Schema.brand("OrganizationId"),
);
export type OrganizationId = typeof OrganizationId.Type;

export const ORGANIZATION_ID = OrganizationId.make("130059740");

const HANDLE_PREFIX = "mw10013-";

/** A pool store's name is this prefix and two digits. */
export const POOL_PREFIX = `${HANDLE_PREFIX}pool-` as const;

/** The stages that run on one store each, `<prefix>-<stage>-shop-NN`. */
export const DeployedStage = Schema.Literals(["staging", "production"]);
export type DeployedStage = typeof DeployedStage.Type;

/**
 * What a store is for, which its name says: `pool`, a store leased to a checkout's dev or e2e
 * environment, or a deployed stage's one store. Not an environment: `production` has a store
 * before it has a stage.
 */
export const StorePurpose = Schema.Literals(["pool", ...DeployedStage.literals]);
export type StorePurpose = typeof StorePurpose.Type;

const StoreIndex = Schema.String.check(Schema.isPattern(/^\d{2}$/u)).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 })),
    SchemaTransformation.transform({
      decode: Number,
      encode: (index) => String(index).padStart(2, "0"),
    }),
  ),
);

const PoolStoreName = Schema.TemplateLiteralParser([POOL_PREFIX, StoreIndex]).pipe(
  Schema.decodeTo(
    Schema.Struct({ purpose: Schema.Literal("pool"), index: Schema.Int }),
    SchemaTransformation.transform({
      decode: (parts) => ({ purpose: "pool" as const, index: parts[1] }),
      encode: ({ index }) => [POOL_PREFIX, index] as const,
    }),
  ),
);

const ShopStoreName = Schema.TemplateLiteralParser([
  HANDLE_PREFIX,
  DeployedStage,
  "-shop-",
  StoreIndex,
]).pipe(
  Schema.decodeTo(
    Schema.Struct({ purpose: DeployedStage, index: Schema.Int }),
    SchemaTransformation.transform({
      decode: (parts) => ({ purpose: parts[1], index: parts[3] }),
      encode: ({ purpose, index }) => [HANDLE_PREFIX, purpose, "-shop-", index] as const,
    }),
  ),
);

/**
 * `NN` is the store's index among its purpose's stores; it says nothing about which checkout holds
 * a pool store. The pool leases a store to one checkout and environment at a time because the CLI
 * rewrites the app's URL per store: two `shopify app dev` sessions on one store overwrite each
 * other's, and the last wins.
 */
export const StoreName = Schema.Union([PoolStoreName, ShopStoreName]);
export type StoreName = typeof StoreName.Type;

const encodeShopStoreName = Schema.encodeSync(ShopStoreName);

/** The name of a deployed stage's store at `index`. No pool store's: the ledger leases them. */
export const storeNameOf = (stage: DeployedStage, index: number) =>
  encodeShopStoreName({ purpose: stage, index });

export const StoreFor = (purposes: readonly StorePurpose[], expected: string) =>
  StoreName.pipe(
    Schema.check(
      Schema.makeFilter(
        (store: StoreName) => purposes.includes(store.purpose) || `expected ${expected}`,
      ),
    ),
  );
