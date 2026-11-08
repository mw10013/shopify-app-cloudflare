import { ShopifyUnavailableError } from "@mw10013/shopify-app-workers/contract";
import { createSerializationAdapter } from "@tanstack/react-router";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

/**
 * TanStack's serializer keeps only an `Error`'s message, so `ShopifyUnavailableError` crosses a
 * server function's failure and the route error SSR hands the browser as its encoded
 * `{ _tag, shop }`, and the App Home's error page still knows it after hydration. Ported from
 * baton's `src/web/start.ts`.
 */
export const shopifyUnavailableAdapter = createSerializationAdapter({
  key: "ShopifyUnavailableError",
  test: Schema.is(ShopifyUnavailableError),
  toSerializable: Schema.encodeSync(ShopifyUnavailableError),
  fromSerializable: Schema.decodeSync(ShopifyUnavailableError),
});

/**
 * A `createStart` instance replaces Start's default request middleware, so the server-function
 * CSRF check it adds without one is restated (`start-server-core` `src/createStartHandler.ts`).
 */
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
  serializationAdapters: [shopifyUnavailableAdapter],
}));
