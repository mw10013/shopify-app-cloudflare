/**
 * What an app's `e2e` stage Backend serves for the end-to-end spec pack: the e2e routes in front
 * of its own `fetch` ({@link withE2eRoutes}), gated by the e2e session. Runs in workerd. The e2e
 * server writes the session (`/test/e2e/server`), the stack binds it (`bindE2eSession` in
 * `/stack`), and the pack reads it (`e2eRoutes` in `/test/e2e`). The app's Website forwards each
 * route's path to the Backend from a file route of its own.
 *
 * @module
 */

export { withE2eRoutes } from "./test/e2e-backend.ts";
export { E2E_STATUS_PATH, E2E_WEBHOOKS_PATH } from "./test/e2e-session.ts";
