import { openMemoryDatabase } from "@mw10013/shopify-app-workers/test/node";
import { expect, test } from "vite-plus/test";

test("the package's /test/node opens node:sqlite under Node", () => {
  const database = openMemoryDatabase();
  expect(database.prepare("select 1 as one").get()).toEqual({ one: 1 });
  database.close();
});
