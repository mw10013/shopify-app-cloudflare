import { ShopifyUnavailableError } from "@mw10013/shopify-app-cloudflare/contract";
import { createSerializationAdapter } from "@tanstack/react-router";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const encodeInstant = Schema.encodeSync(Schema.DateTimeUtcFromMillis);
const decodeInstant = Schema.decodeSync(Schema.DateTimeUtcFromMillis);

/**
 * A `DateTime.Utc` across a server function's answer and the loader data SSR hands the browser,
 * as epoch ms: TanStack's serializer refuses an object with a prototype of its own.
 */
const dateTimeUtcAdapter = createSerializationAdapter({
  key: "DateTime.Utc",
  test: (value): value is DateTime.Utc => DateTime.isDateTime(value) && DateTime.isUtc(value),
  toSerializable: encodeInstant,
  fromSerializable: (millis: number) => decodeInstant(millis),
});

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
  serializationAdapters: [dateTimeUtcAdapter, shopifyUnavailableAdapter],
}));
