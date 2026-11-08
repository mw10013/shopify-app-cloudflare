/**
 * The long-lived e2e server's command line for an app's `scripts/e2e.ts`
 * ({@link e2eServerCommand}): it starts, reports, restarts and reinstalls the checkout's
 * `shopify app dev` on its e2e lease's pool store, writes the e2e session the stack binds and the
 * spec pack reads, and grants the store auth the pack needs. Runs in Node; needs the optional
 * peers `@mw10013/devkit`, `@effect/platform-node` and `playwright`.
 *
 * @module
 */

export { e2eServerCommand, type E2eServerOptions } from "./test/e2e/server.ts";
