import { readFileSync } from "node:fs";

import { ADMIN_API_VERSION } from "@mw10013/shopify-app-workers/backend";
import { expect, test } from "vite-plus/test";

test("shopify.app.toml's webhooks api_version is the package's Admin API version", () => {
  const toml = readFileSync(new URL("../../shopify.app.toml", import.meta.url), "utf8");
  expect(toml).toContain(`api_version = "${ADMIN_API_VERSION}"`);
});
