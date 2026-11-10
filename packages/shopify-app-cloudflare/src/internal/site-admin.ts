import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type Failures, type Method, serve, type Undeclared } from "./serve.ts";
import { ForbiddenError } from "./shop-actor-contract.ts";
import { AdminRefusal, RequestInfo, type SiteUser } from "./site-auth-contract.ts";
import { Auth } from "./site-auth.ts";

const decodeRequestInfo = Schema.decodeUnknownEffect(RequestInfo);

/**
 * The signed-in admin of the request: {@link UnauthorizedError} with no session, `ForbiddenError`
 * when the user's role is not `admin`.
 */
export const requireAdmin = Effect.fn("Backend.requireAdmin")(function* (
  request: RequestInfo,
): Effect.fn.Return<SiteUser, AdminRefusal, Auth> {
  const { cookie } = yield* decodeRequestInfo(request).pipe(Effect.orDie);
  const { user } = yield* (yield* Auth).session(cookie);
  if (user.role !== "admin") return yield* new ForbiddenError();
  return user;
});

/** `methods` as {@link serveAdmin} serves them: the request first, the gate's refusals added. */
export type AdminServed<M, F extends { readonly [K in keyof M]: Failures }> = {
  readonly [K in keyof M]: M[K] extends (
    ...args: infer P
  ) => Effect.Effect<infer A, unknown, infer R>
    ? (
        request: RequestInfo,
        ...args: P
      ) => Effect.Effect<A, F[K]["Encoded"] | typeof AdminRefusal.Encoded, R>
    : never;
};

/**
 * Every method of `methods` as an admin's Backend method, each through `serve` as `serveAll`
 * serves them: it takes the request's {@link RequestInfo} first, runs {@link requireAdmin} on it
 * before the method, and declares `UnauthorizedError` and `ForbiddenError` beside its
 * `failures` entry.
 *
 * @example
 * ```ts
 * yield* serveAdmin({ refreshPlan }, { refreshPlan: Schema.Never });
 * ```
 */
export const serveAdmin = <
  M extends { readonly [K in keyof M]: Method },
  F extends { readonly [K in keyof M]: Failures },
>(
  methods: M,
  failures: F & {
    readonly [K in keyof M]: [Undeclared<M[K], F[K]>] extends [never]
      ? unknown
      : { readonly undeclared: Undeclared<M[K], F[K]> };
  },
): Effect.Effect<AdminServed<M, F>, never, Auth> =>
  Effect.map(
    Effect.context<Auth>(),
    (context) =>
      Object.fromEntries(
        Object.entries<Method>(methods).map(([name, method]) => [
          name,
          (request: RequestInfo, ...args: never) =>
            serve(
              name,
              requireAdmin(request).pipe(Effect.provide(context), Effect.andThen(method(...args))),
              Schema.Union([failures[name as keyof M], AdminRefusal]),
            ),
        ]),
      ) as AdminServed<M, F>,
  );
