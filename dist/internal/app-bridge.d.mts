import * as Effect from "effect/Effect";
/**
 * An ID token minted for each use: the merchant socket's credential on every connect, since a
 * browser cannot set a header on a WebSocket upgrade and a token outlives no reconnect after a
 * minute.
 */
export declare const mintIdToken: Effect.Effect<string>;
/** A toast in the Shopify admin's chrome; `isError` for a press that failed. */
export declare const toast: (message: string, options?: {
  readonly isError?: boolean;
}) => unknown;
/** Shows or hides the contextual save bar whose `ui-save-bar` has `id`. */
export declare const showSaveBar: (id: string, show: boolean) => Promise<void>;