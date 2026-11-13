import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

/**
 * Logs a defect at Error with `operation` and re-raises it, so the caller still sees it. A
 * boundary that hands a defect to someone else wraps its methods in this, because nothing else
 * logs one: Effect's `RpcServer` sends a procedure's defect to the client. Typed failures are
 * expected outcomes and pass unlogged.
 */
export const logDefect =
  (operation: string, annotations: Record<string, unknown> = {}) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapCauseIf(Cause.hasDies, (cause) =>
        Effect.logError(`${operation}: defect`, cause).pipe(Effect.annotateLogs(annotations)),
      ),
    );

/**
 * `defect` as a plain `Error` chain: each link's `name`, `message`, string, number and boolean
 * fields, and `cause`. Workers RPC carries a thrown error's own properties and `cause` only while
 * every value beneath it serializes; one function anywhere (a `SchemaError`'s issue holds its
 * schema's checks) reduces the whole error to an `Error` of `<name>: <message>`, its cause and
 * fields gone.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/rpc/error-handling/
 */
export const crossableDefect = (defect: unknown, seen: ReadonlySet<unknown> = new Set()): Error => {
  if (typeof defect !== "object" || defect === null) return new Error(String(defect));
  const original = defect as Record<string, unknown>;
  const cause = original.cause;
  const error = new Error(
    typeof original.message === "string" ? original.message : "",
    cause === undefined || seen.has(cause)
      ? undefined
      : { cause: crossableDefect(cause, new Set([...seen, defect])) },
  );
  if (typeof original.name === "string") error.name = original.name;
  for (const [key, value] of Object.entries(original)) {
    const primitive = ["string", "number", "boolean"].includes(typeof value);
    if (primitive && !(key in error)) Object.assign(error, { [key]: value });
  }
  return error;
};

/**
 * `methods` with each defect replaced by its {@link crossableDefect}, for the methods a Durable
 * Object serves over Workers RPC: Alchemy throws a method's defect as it is, and the caller logs
 * what arrives.
 */
export const crossDefects = <M extends { readonly [K in keyof M]: (...args: never) => unknown }>(
  methods: M,
): M =>
  Object.fromEntries(
    Object.entries<(...args: never) => unknown>(methods).map(([name, method]) => [
      name,
      (...args: never) => {
        const result = method(...args);
        if (!Effect.isEffect(result)) return result;
        return result.pipe(Effect.catchDefect((defect) => Effect.die(crossableDefect(defect))));
      },
    ]),
  ) as M;
