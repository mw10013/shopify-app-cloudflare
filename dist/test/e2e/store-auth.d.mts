import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
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
export {};