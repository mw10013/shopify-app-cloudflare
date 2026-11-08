/**
 * Test support that needs Node: `D1Test` over `node:sqlite`, the in-process harness over it and
 * the migration copy check. Never imported by a Worker, so the workerd bundle stays free of
 * `node:sqlite`.
 *
 * @module
 */

export { D1Test, type D1TestOptions, type D1TestShape } from "./test/node/d1-test.ts";
export { expectMigrationsSynced, PACKAGE_MIGRATIONS_DIR } from "./test/node/migrations.ts";
export { inProcessHarness } from "./test/node/shopify-harness.ts";
