import { RequiredBehavior } from "./auth-behaviors.mjs";
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
export declare const REQUIRED_BEHAVIORS: readonly RequiredBehavior[];