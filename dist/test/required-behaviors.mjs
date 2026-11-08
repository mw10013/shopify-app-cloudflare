import { AUTH_BEHAVIORS } from "./auth-behaviors.mjs";
import { APP_BEHAVIORS } from "./app-behaviors.mjs";
// src/test/required-behaviors.ts
/**
* The one list of required behaviors an app's suite runs: authentication, then billing, the
* merchant gate, hooks and webhooks. Data only, so a runner in Node or a test Backend in workerd
* loops over the same cases.
*
* @module
*/
/**
* Every required behavior. An `id` is the spec's case number, which a case's variants share, so a
* runner names each test `<id>: <name>`. A harness runs a case only if it has every capability
* the case `needs`, and skips the rest:
*
* ```ts
* for (const behavior of REQUIRED_BEHAVIORS) {
*   const run = () => behavior.run.pipe(Effect.provide(inProcessHarness({ app, migrationsDir })));
*   const options = { timeout: behavior.timeout ?? 5000 };
*   if (behavior.needs.includes("clock")) it.effect(`${behavior.id}: ${behavior.name}`, run, options);
*   else it.live(`${behavior.id}: ${behavior.name}`, run, options);
* }
* ```
*/
const REQUIRED_BEHAVIORS = [...AUTH_BEHAVIORS, ...APP_BEHAVIORS];
export { REQUIRED_BEHAVIORS };
