import * as Effect from "effect/Effect";
// src/internal/app-bridge.ts
/**
* The App Bridge calls an embedded page makes, through the `shopify` global App Bridge installs.
* Only these three are declared, so the package needs no `@shopify/app-bridge-types`.
*
* @module
*/
const appBridge = () => globalThis.shopify;
/**
* An ID token minted for each use: the merchant socket's credential on every connect, since a
* browser cannot set a header on a WebSocket upgrade and a token outlives no reconnect after a
* minute.
*/
const mintIdToken = Effect.promise(() => appBridge().idToken());
/** A toast in the Shopify admin's chrome; `isError` for a press that failed. */
const toast = (message, options) => appBridge().toast.show(message, options);
/** Shows or hides the contextual save bar whose `ui-save-bar` has `id`. */
const showSaveBar = (id, show) => show ? appBridge().saveBar.show(id) : appBridge().saveBar.hide(id);
export { mintIdToken, showSaveBar, toast };
