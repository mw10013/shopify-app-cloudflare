import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
declare const StoreAuthError_base: Schema.Class<StoreAuthError, Schema.TaggedStruct<"StoreAuthError", {
  readonly message: Schema.String;
  readonly cause: Schema.optionalKey<Schema.Defect>;
}>, import("effect/Cause").YieldableError>;
export declare class StoreAuthError extends StoreAuthError_base {}
/** The scopes of `wanted` that `granted` lacks: Shopify's `write_X` includes `read_X`. */
export declare const missingScopes: (wanted: readonly string[], granted: readonly string[]) => string[];
/**
 * The CLI prints progress events, one JSON object per line, then the result as one pretty-printed
 * object over several lines, so the result is the last object, not the last line.
 */
export declare const resultText: (stdout: string) => string;
/**
 * The scopes `shop`'s store auth lacks, every one of `wanted` when the CLI holds no session for
 * it.
 */
export declare const storeAuthMissing: (shop: string, wanted: readonly string[]) => Effect.Effect<string[], StoreAuthError, import("effect/process/ChildProcessSpawner").ChildProcessSpawner>;
/**
 * Grants `store` store auth with `scopes`, approving Shopify's page in the agent Chrome. A pool
 * store arrives in whatever state its last holder left it, so this checks first and does nothing
 * when the store already has every scope. `shopify store auth` opens its URL in the default
 * browser, so a stand-in `open` first on its `PATH` catches the URL for the agent Chrome to
 * approve. A lapsed Shopify login in the agent Chrome fails for a person to fix.
 */
export declare const authorizeStore: (store: string, scopes: readonly string[]) => Effect.Effect<undefined, import("effect/PlatformError").PlatformError | StoreAuthError, import("effect/process/ChildProcessSpawner").ChildProcessSpawner | FileSystem.FileSystem>;
export {};