import * as Effect from "effect/Effect";
/**
 * Logs a defect at Error with `operation` and re-raises it, so the caller still sees it. A
 * boundary that hands a defect to someone else wraps its methods in this, because nothing else
 * logs one: Effect's `RpcServer` sends a procedure's defect to the client. Typed failures are
 * expected outcomes and pass unlogged.
 */
export declare const logDefect: (operation: string, annotations?: Record<string, unknown>) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
/**
 * `methods` with each defect replaced by its {@link crossableDefect}, for the methods a Durable
 * Object serves over Workers RPC: Alchemy throws a method's defect as it is, and the caller logs
 * what arrives.
 */
export declare const crossDefects: <M extends { readonly [K in keyof M]: (...args: never) => unknown; }>(methods: M) => M;