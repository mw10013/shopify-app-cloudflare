/**
 * The App Bridge calls an embedded page makes, through the `shopify` global App Bridge installs.
 * Only these three are declared, so the package needs no `@shopify/app-bridge-types`.
 *
 * @module
 */

import * as Effect from "effect/Effect";

interface AppBridge {
  readonly idToken: () => Promise<string>;
  readonly toast: {
    readonly show: (message: string, options?: { readonly isError?: boolean }) => unknown;
  };
  readonly saveBar: {
    readonly show: (id: string) => Promise<void>;
    readonly hide: (id: string) => Promise<void>;
  };
}

const appBridge = () => (globalThis as typeof globalThis & { readonly shopify: AppBridge }).shopify;

/**
 * An ID token minted for each use: the merchant socket's credential on every connect, since a
 * browser cannot set a header on a WebSocket upgrade and a token outlives no reconnect after a
 * minute.
 */
export const mintIdToken: Effect.Effect<string> = Effect.promise(() => appBridge().idToken());

/** A toast in the Shopify admin's chrome; `isError` for a press that failed. */
export const toast = (message: string, options?: { readonly isError?: boolean }) =>
  appBridge().toast.show(message, options);

/** Shows or hides the contextual save bar whose `ui-save-bar` has `id`. */
export const showSaveBar = (id: string, show: boolean) =>
  show ? appBridge().saveBar.show(id) : appBridge().saveBar.hide(id);
