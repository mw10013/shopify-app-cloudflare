import * as Effect from "effect/Effect";
/**
 * `effect` as one job of a Backend's cron handler: any failure, a defect or an interruption
 * included, is logged at Error as `Backend.scheduled: job=<job> status=failed` with its cause, and
 * the job succeeds. Why: Alchemy's cron event source swallows a handler's cause unlogged, so a
 * failure no job logs, such as its store failing before its own per-item handling, would vanish;
 * and one job's failure does not skip the next. Run it inside the handler's
 * `Effect.fn("Backend.scheduled")`.
 */
export declare const scheduledJob: <A, E, R>(job: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>;