import { D1Test } from "@mw10013/shopify-app-workers/test/node";
import * as Effect from "effect/Effect";
import { expect, test } from "vite-plus/test";

test("the package's /test/node opens node:sqlite under Node, migrated with the package's table", () => {
  const { sqlite } = Effect.runSync(D1Test.make());
  expect(sqlite.prepare("select count(*) as n from AppInstallation").get()).toEqual({ n: 0 });
  sqlite.close();
});
