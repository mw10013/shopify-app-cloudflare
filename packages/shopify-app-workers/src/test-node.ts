/**
 * Test support that needs Node: `D1Test` over `node:sqlite`. Never imported by a Worker, so the
 * workerd bundle stays free of `node:sqlite`.
 *
 * @module
 */

import { DatabaseSync } from "node:sqlite";

/**
 * Roadmap step 2, unit 0 spike: an in-memory SQLite database, standing in for unit 3's `D1Test`
 * to show a `node:sqlite` module can sit behind `/test/node`.
 */
export const openMemoryDatabase = () => new DatabaseSync(":memory:");
