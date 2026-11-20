import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

/**
 * The context in effect, captured for re-providing inside a later event (a request, a stub
 * call, an alarm), less its loggers. Alchemy builds a Worker's loggers into each event; a context
 * captured at init or activation still holds the isolate's default loggers, and re-providing it
 * would put them back over the event's.
 */
export const capturedContext = <R>(): Effect.Effect<Context.Context<R>, never, R> =>
  Effect.map(Effect.context<R>(), Context.omit(Logger.CurrentLoggers));
