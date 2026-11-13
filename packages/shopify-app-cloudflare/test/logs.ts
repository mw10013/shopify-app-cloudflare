import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

export interface Logged {
  readonly level: string;
  readonly message: unknown;
}

export const capturingLogs =
  (logged: Logged[]) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          Logger.layer([
            Logger.make(({ message, logLevel }) => {
              logged.push({
                level: logLevel,
                message: Array.isArray(message) ? message[0] : message,
              });
            }),
          ]),
          Layer.succeed(References.MinimumLogLevel, "All"),
        ),
      ),
    );
