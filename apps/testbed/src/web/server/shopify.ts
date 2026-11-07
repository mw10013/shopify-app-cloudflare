import { createServerFn } from "@tanstack/react-start";

import { env } from "./env.server.ts";

/** The app's API key, which App Bridge reads from the App Home's `shopify-api-key` meta. */
export const getApiKey = createServerFn({ method: "GET" }).handler(() => ({
  apiKey: env.SHOPIFY_API_KEY,
}));
