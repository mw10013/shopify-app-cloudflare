/**
 * The required behaviors of authentication (`shopify-auth.md`'s numbered cases), as data: each
 * case is `{ id, name, run }`, asserting with `node:assert`, so an app's suite loops over them
 * with its own runner and nothing here imports one.
 *
 * @module
 */

import assert from "node:assert/strict";

import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { ShopDomain, ShopGid } from "#internal/domain.ts";

import { mintIdToken } from "./id-token.ts";
import {
  FAKE_SHOP_GID,
  grantBody,
  REFRESH_GRANT,
  ShopifyFake,
  type ShopifyFakeCall,
  TOKEN_EXCHANGE_GRANT,
} from "./shopify-fake.ts";
import {
  type HarnessCapability,
  type SeedInstallation,
  ShopifyHarness,
} from "./shopify-harness.ts";

/** One required behavior: a spec case by number, or a package case (`N…`). */
export interface RequiredBehavior {
  readonly id: string;
  readonly name: string;
  /** What the harness must be able to do; a harness without it skips the case. */
  readonly needs: readonly HarnessCapability[];
  /** The case's budget in milliseconds, when retries or a deadline make it slow. */
  readonly timeout?: number;
  readonly run: Effect.Effect<void, unknown, ShopifyHarness | ShopifyFake>;
}

/** The shop every case runs against. */
export const BEHAVIOR_SHOP = Schema.decodeUnknownSync(ShopDomain)("behavior-shop.myshopify.com");

/** The seeded shop's id; a first install fetches `FAKE_SHOP_GID` instead. */
export const BEHAVIOR_SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/1");

const SHOP = BEHAVIOR_SHOP;

/** An installation whose access token expired a second before `now`; its refresh token has 30 days. */
const rowAt = (now: DateTime.Utc, over: Partial<SeedInstallation> = {}): SeedInstallation => ({
  shop: SHOP,
  shopGid: BEHAVIOR_SHOP_GID,
  scope: "read_orders",
  accessToken: "shpat_old",
  accessTokenExpiresAt: DateTime.subtractDuration(now, Duration.seconds(1)),
  refreshToken: "shprt_old",
  refreshTokenExpiresAt: DateTime.addDuration(now, Duration.days(30)),
  ...over,
});

/** Seeds {@link rowAt} at the current instant. */
const seedAt = (over: Partial<SeedInstallation> = {}) =>
  Effect.gen(function* () {
    const harness = yield* ShopifyHarness;
    yield* harness.seed(rowAt(yield* DateTime.now, over));
  });

const ensure = Effect.flatMap(ShopifyHarness, (harness) => harness.ensureSession(SHOP));

const authenticateWith = (over: { readonly apiSecret?: string; readonly iss?: string } = {}) =>
  Effect.gen(function* () {
    const harness = yield* ShopifyHarness;
    return yield* harness.authenticateMerchant(yield* mintIdToken({ shop: SHOP, ...over }));
  });
const authenticate = authenticateWith();

const QUERY = "query ShopGid { shop { id } }";
const adminGraphql = Effect.flatMap(ShopifyHarness, (harness) => harness.adminGraphql(SHOP, QUERY));

const stored = Effect.flatMap(ShopifyHarness, (harness) => harness.stored(SHOP));
const storedRow = Effect.map(stored, (row) => {
  assert.ok(Option.isSome(row), "the shop has a row");
  return row.value;
});

const calls = Effect.flatMap(ShopifyFake, (fake) => fake.calls);

/** Each call as the grant it made, or `graphql`. */
const grantsOf = (made: readonly ShopifyFakeCall[]) =>
  made.map((call) => (call.route === "graphql" ? "graphql" : (call.grantType ?? "token")));

/** The invariant every concurrency case ends on: Shopify accepts the stored refresh token. */
const assertInvariant = Effect.gen(function* () {
  const fake = yield* ShopifyFake;
  const row = yield* storedRow;
  assert.ok(
    yield* fake.accepts(SHOP, row.refreshToken),
    "Shopify accepts the stored refresh token",
  );
});

/** The `refreshTokenState` of a `ReauthenticationRequiredError`, else the failure's `_tag`. */
const verdict = (error: unknown) =>
  typeof error === "object" && error !== null && "refreshTokenState" in error
    ? String(error.refreshTokenState)
    : typeof error === "object" && error !== null && "_tag" in error
      ? String(error._tag)
      : "unknown";

const failureOf = <R>(effect: Effect.Effect<unknown, unknown, R>) =>
  Effect.map(Effect.flip(effect), verdict);

const assertDefect = <R>(effect: Effect.Effect<unknown, unknown, R>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause), "expected a defect");
  });

/** Waits until the fake has served `count` calls. */
const callsReach = (count: number) =>
  Effect.gen(function* () {
    while ((yield* calls).length < count) yield* Effect.sleep("10 millis");
  });

/** A gate an intercepted call waits on before the fake answers it. */
const makeGate = Effect.map(
  // oxlint-disable-next-line typescript/no-invalid-void-type -- a gate that opens with no value
  Deferred.make<void>(),
  (gate) => ({
    wait: () => Effect.runPromise(Deferred.await(gate)),
    open: Deferred.succeed(gate, undefined),
  }),
);

/**
 * Runs `first` and, once its first call is in, `joiner`, with every token call held at a gate
 * that opens after the joiner has had time to join: both callers' answers.
 */
const gated = <A, B, E1, E2, R1, R2>(
  first: Effect.Effect<A, E1, R1>,
  joiner: Effect.Effect<B, E2, R2>,
) =>
  Effect.gen(function* () {
    const fake = yield* ShopifyFake;
    const gate = yield* makeGate;
    yield* fake.intercept((call, _attempt, answer) =>
      call.route === "token" ? gate.wait().then(answer) : answer(),
    );
    const [a, b] = yield* Effect.all(
      [
        first,
        Effect.andThen(callsReach(1), joiner),
        Effect.gen(function* () {
          yield* callsReach(1);
          yield* Effect.sleep("150 millis");
          yield* gate.open;
        }),
      ],
      { concurrency: "unbounded" },
    );
    return [a, b] as const;
  });

const clock: readonly HarnessCapability[] = ["clock"];
const interleave: readonly HarnessCapability[] = ["interleave"];

const behavior = (
  id: string,
  name: string,
  run: RequiredBehavior["run"],
  options: { readonly needs?: readonly HarnessCapability[]; readonly timeout?: number } = {},
): RequiredBehavior => ({
  id,
  name,
  needs: options.needs ?? [],
  ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  run,
});

/** `ensureSession` with no grant: cases 9–12, on the test clock. */
const ensureWithoutGrant: readonly RequiredBehavior[] = [
  behavior(
    "9",
    "a fresh access token: answered with no grant",
    Effect.gen(function* () {
      yield* seedAt({
        accessTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.minutes(10)),
      });
      assert.equal((yield* ensure).accessToken, "shpat_old");
      assert.equal((yield* calls).length, 0);
    }),
    { needs: clock },
  ),
  behavior(
    "10",
    "no row: AppNotInstalledError",
    Effect.gen(function* () {
      assert.equal(yield* failureOf(ensure), "AppNotInstalledError");
    }),
    { needs: clock },
  ),
  ...(
    [
      ["no refresh token", { refreshToken: null }],
      ["no refresh expiry", { refreshTokenExpiresAt: null }],
    ] as const
  ).map(([name, over]) =>
    behavior(
      "11",
      `${name}: ReauthenticationRequiredError { refreshTokenState: "missing" }`,
      Effect.gen(function* () {
        yield* seedAt(over);
        assert.equal(yield* failureOf(ensure), "missing");
        assert.equal((yield* calls).length, 0);
      }),
      { needs: clock },
    ),
  ),
  behavior(
    "12",
    'refresh token within its buffer of expiry, as TestClock crosses it: ReauthenticationRequiredError { refreshTokenState: "expired" }, no grant',
    Effect.gen(function* () {
      yield* seedAt({
        refreshTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.minutes(2)),
      });
      yield* TestClock.adjust("60 seconds");
      assert.equal(yield* failureOf(ensure), "expired");
      assert.equal((yield* calls).length, 0);
    }),
    { needs: clock },
  ),
  behavior(
    "12",
    "one millisecond before that buffer the refresh token is still tried",
    Effect.gen(function* () {
      yield* seedAt({
        refreshTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.minutes(2)),
      });
      yield* TestClock.adjust(59_999);
      yield* ensure;
      assert.deepEqual(grantsOf(yield* calls), [REFRESH_GRANT]);
    }),
    { needs: clock },
  ),
];

/** `ensureSession` refreshing: cases 13, 18, 20–24, 26, 27 and 49. */
const ensureRefreshing: readonly RequiredBehavior[] = [
  behavior(
    "13",
    "expired access token: one grant, rotated row",
    Effect.gen(function* () {
      yield* seedAt();
      const session = yield* ensure;
      assert.equal(session.accessToken, "shpat_1");
      assert.deepEqual(
        (yield* calls).map((call) => call.refreshToken),
        ["shprt_old"],
      );
      const row = yield* storedRow;
      assert.equal(row.accessToken, "shpat_1");
      assert.equal(row.refreshToken, "shprt_1");
      assert.equal(row.scope, "read_orders", "a refresh never rewrites scope");
      assert.ok(
        row.accessTokenExpiresAt !== null &&
          DateTime.isLessThan(yield* DateTime.now, row.accessTokenExpiresAt),
      );
      yield* assertInvariant;
    }),
  ),
  behavior(
    "13",
    "a row with no access token and a usable refresh token refreshes",
    Effect.gen(function* () {
      yield* seedAt({ accessToken: null, accessTokenExpiresAt: null });
      assert.equal((yield* ensure).accessToken, "shpat_1");
      yield* assertInvariant;
    }),
  ),
  behavior(
    "18",
    'grant 401: ReauthenticationRequiredError { refreshTokenState: "rejected" } at once, row unchanged',
    Effect.gen(function* () {
      yield* seedAt({ recognized: false });
      const before = yield* storedRow;
      assert.equal(yield* failureOf(ensure), "rejected");
      assert.equal((yield* calls).length, 1);
      assert.deepEqual(yield* storedRow, before);
    }),
  ),
  ...[400, 403].map((status) =>
    behavior(
      "20",
      `grant ${String(status)}: a defect after one call`,
      Effect.gen(function* () {
        yield* seedAt();
        yield* (yield* ShopifyFake).script([
          { route: "token", status, body: { error: "invalid_request" } },
        ]);
        yield* assertDefect(ensure);
        assert.equal((yield* calls).length, 1);
        assert.equal((yield* storedRow).refreshToken, "shprt_old");
      }),
    ),
  ),
  ...(
    [
      [503, { error: "down" }],
      [429, { error: "throttled" }],
    ] as const
  ).map(([status, body]) =>
    behavior(
      "21",
      `grant ${String(status)} then 200: retried with the same refresh token; succeeds`,
      Effect.gen(function* () {
        yield* seedAt();
        yield* (yield* ShopifyFake).script([{ route: "token", status, body }]);
        assert.equal((yield* ensure).accessToken, "shpat_1");
        assert.deepEqual(
          (yield* calls).map((call) => call.refreshToken),
          ["shprt_old", "shprt_old"],
        );
        yield* assertInvariant;
      }),
    ),
  ),
  behavior(
    "21",
    "a network error, then 200: retried with the same refresh token; succeeds",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([{ route: "token", networkError: true }]);
      assert.equal((yield* ensure).accessToken, "shpat_1");
      assert.deepEqual(
        (yield* calls).map((call) => call.refreshToken),
        ["shprt_old", "shprt_old"],
      );
    }),
  ),
  behavior(
    "21",
    "an attempt past GRANT_ATTEMPT_DEADLINE, then 200: retried; succeeds",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([{ route: "token", hang: true }]);
      assert.equal((yield* ensure).accessToken, "shpat_1");
      assert.equal((yield* calls).length, 2);
    }),
    { timeout: 12_000 },
  ),
  behavior(
    "21",
    "a 502 whose body is not JSON is transient",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([
        { route: "token", status: 502, text: "<html>Bad gateway</html>" },
      ]);
      assert.equal((yield* ensure).accessToken, "shpat_1");
      assert.equal((yield* calls).length, 2);
    }),
  ),
  ...(
    [
      [503, { error: "down" }],
      [429, { error: "throttled" }],
    ] as const
  ).map(([status, body]) =>
    behavior(
      "22",
      `grant ${String(status)} every time: ShopifyUnavailableError after GRANT_TRANSIENT_RETRIES retries`,
      Effect.gen(function* () {
        yield* seedAt();
        yield* (yield* ShopifyFake).script(
          Array.from({ length: 3 }, () => ({ route: "token" as const, status, body })),
        );
        assert.equal(yield* failureOf(ensure), "ShopifyUnavailableError");
        assert.equal((yield* calls).length, 3);
        assert.equal((yield* storedRow).refreshToken, "shprt_old");
      }),
      { timeout: 8000 },
    ),
  ),
  behavior(
    "23",
    "a grant failure whose body is not JSON: transient whatever its status; ShopifyUnavailableError after GRANT_TRANSIENT_RETRIES retries",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script(
        Array.from({ length: 3 }, () => ({
          route: "token" as const,
          status: 400,
          text: "<html>Bad request</html>",
        })),
      );
      assert.equal(yield* failureOf(ensure), "ShopifyUnavailableError");
      assert.equal((yield* calls).length, 3);
    }),
    { timeout: 8000 },
  ),
  behavior(
    "24",
    "a grant response without refresh_token_expires_in: a defect; row unchanged",
    Effect.gen(function* () {
      yield* seedAt();
      const before = yield* storedRow;
      yield* (yield* ShopifyFake).script([
        { route: "token", body: grantBody({ refresh_token_expires_in: undefined }) },
      ]);
      yield* assertDefect(ensure);
      assert.equal((yield* calls).length, 1);
      assert.deepEqual(yield* storedRow, before);
    }),
  ),
  behavior(
    "26",
    "a caller interrupted mid-grant: the pair is still stored",
    Effect.gen(function* () {
      yield* seedAt();
      const fake = yield* ShopifyFake;
      const gate = yield* makeGate;
      yield* fake.intercept((_call, _attempt, answer) => gate.wait().then(answer));
      const caller = yield* Effect.forkChild(ensure);
      yield* callsReach(1);
      yield* Fiber.interrupt(caller);
      yield* gate.open;
      while ((yield* storedRow).refreshToken === "shprt_old") yield* Effect.sleep("10 millis");
      assert.equal((yield* storedRow).refreshToken, "shprt_1");
      yield* assertInvariant;
    }),
    { needs: interleave },
  ),
  behavior(
    "27",
    "repair: a stored refresh token the fake has retired fails with refreshTokenState rejected; after the next exchange a refresh succeeds",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      yield* seedAt({ recognized: false });
      assert.equal(yield* failureOf(ensure), "rejected");
      yield* authenticate;
      yield* assertInvariant;
      yield* harness.expireAccessToken(SHOP);
      assert.equal((yield* ensure).accessToken, "shpat_2");
      yield* assertInvariant;
    }),
    { timeout: 8000 },
  ),
  behavior(
    "49",
    "an uninstall during a refresh: no pair written, AppNotInstalledError, no row",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      const fake = yield* ShopifyFake;
      yield* seedAt();
      yield* fake.intercept((_call, _attempt, answer) =>
        Effect.runPromise(harness.uninstall(SHOP)).then(answer),
      );
      assert.equal(yield* failureOf(ensure), "AppNotInstalledError");
      assert.ok(Option.isNone(yield* stored));
    }),
    { needs: interleave },
  ),
];

/** `ensureSession` and the grant in flight: cases 14 and 17. */
const ensureInFlight: readonly RequiredBehavior[] = [
  behavior(
    "14",
    "two concurrent callers on an expired token: exactly one grant; both answer the new pair",
    Effect.gen(function* () {
      yield* seedAt();
      const [first, second] = yield* gated(ensure, ensure);
      assert.equal(first.accessToken, "shpat_1");
      assert.equal(second.accessToken, "shpat_1");
      assert.equal((yield* calls).length, 1);
      yield* assertInvariant;
    }),
    { needs: interleave },
  ),
  behavior(
    "17",
    "a refresh due while an exchange is in flight: it joins it and answers the exchange's pair, with no refresh grant",
    Effect.gen(function* () {
      yield* seedAt();
      const [, session] = yield* gated(authenticate, ensure);
      assert.equal(session.accessToken, "shpat_1");
      assert.deepEqual(grantsOf(yield* calls), [TOKEN_EXCHANGE_GRANT]);
      yield* assertInvariant;
    }),
    { needs: interleave },
  ),
];

/** The merchant path: cases 28, 29, 31–38 and 50. */
const merchantPath: readonly RequiredBehavior[] = [
  behavior(
    "28",
    "a fresh stored token: no exchange",
    Effect.gen(function* () {
      yield* seedAt({
        accessTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.hours(1)),
      });
      assert.deepEqual(yield* authenticate, { shop: SHOP, shopGid: BEHAVIOR_SHOP_GID });
      assert.equal((yield* calls).length, 0);
    }),
  ),
  behavior(
    "29",
    "a merchant arriving during a refresh: joins it; no exchange; the refreshed row is used",
    Effect.gen(function* () {
      yield* seedAt();
      const [, answer] = yield* gated(ensure, authenticate);
      assert.equal(answer.shopGid, BEHAVIOR_SHOP_GID);
      assert.deepEqual(grantsOf(yield* calls), [REFRESH_GRANT]);
      assert.equal((yield* storedRow).accessToken, "shpat_1");
    }),
    { needs: interleave },
  ),
  behavior(
    "31",
    "two concurrent exchanges on an installed shop: one grant; both merchants answered; the invariant holds",
    Effect.gen(function* () {
      yield* seedAt();
      const [first, second] = yield* gated(authenticate, authenticate);
      assert.deepEqual(first, second);
      assert.deepEqual(grantsOf(yield* calls), [TOKEN_EXCHANGE_GRANT]);
      yield* assertInvariant;
    }),
    { needs: interleave },
  ),
  behavior(
    "32",
    "two concurrent first installs: one grant, one shopGid fetch, one row",
    Effect.gen(function* () {
      const [first, second] = yield* gated(authenticate, authenticate);
      assert.deepEqual(first, { shop: SHOP, shopGid: FAKE_SHOP_GID });
      assert.deepEqual(second, first);
      assert.deepEqual(grantsOf(yield* calls), [TOKEN_EXCHANGE_GRANT, "graphql"]);
      yield* assertInvariant;
    }),
    { needs: interleave },
  ),
  ...(
    [
      ["an installed shop", true],
      ["a first install", false],
    ] as const
  ).map(([name, installed]) =>
    behavior(
      "33",
      `an uninstall during the exchange's grant, on ${name}: ShopifyUnavailableError, no row afterwards`,
      Effect.gen(function* () {
        const harness = yield* ShopifyHarness;
        const fake = yield* ShopifyFake;
        if (installed) yield* seedAt();
        yield* fake.intercept((call, _attempt, answer) =>
          call.route === "token"
            ? Effect.runPromise(harness.uninstall(SHOP)).then(answer)
            : answer(),
        );
        assert.equal(yield* failureOf(authenticate), "ShopifyUnavailableError");
        assert.ok(Option.isNone(yield* stored));
      }),
      { needs: interleave },
    ),
  ),
  behavior(
    "33",
    "an uninstall while a first install's write is on the wire waits for it: no row afterwards",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      const held = yield* harness.holdWrite;
      const merchant = yield* Effect.forkChild(authenticate);
      yield* held.started;
      let uninstalled = false;
      const uninstalling = yield* Effect.forkChild(
        Effect.tap(harness.uninstall(SHOP), () =>
          Effect.sync(() => {
            uninstalled = true;
          }),
        ),
      );
      yield* Effect.sleep("100 millis");
      assert.equal(uninstalled, false, "the uninstall waits for the write");
      yield* held.release;
      assert.deepEqual(yield* Fiber.join(merchant), { shop: SHOP, shopGid: FAKE_SHOP_GID });
      yield* Fiber.join(uninstalling);
      assert.ok(Option.isNone(yield* stored));
    }),
    { needs: interleave },
  ),
  behavior(
    "34",
    "an ID token signed with another secret: InvalidIdTokenError",
    Effect.gen(function* () {
      yield* seedAt();
      assert.equal(
        yield* failureOf(authenticateWith({ apiSecret: "another-secret" })),
        "InvalidIdTokenError",
      );
      assert.equal((yield* calls).length, 0);
    }),
  ),
  behavior(
    "35",
    "an ID token whose iss and dest name different shops: InvalidIdTokenError",
    Effect.gen(function* () {
      yield* seedAt();
      assert.equal(
        yield* failureOf(authenticateWith({ iss: "https://other-shop.myshopify.com/admin" })),
        "InvalidIdTokenError",
      );
      assert.equal((yield* calls).length, 0);
    }),
  ),
  behavior(
    "36",
    "exchange answering 400 invalid_subject_token: InvalidIdTokenError",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([
        { route: "token", status: 400, body: { error: "invalid_subject_token" } },
      ]);
      assert.equal(yield* failureOf(authenticate), "InvalidIdTokenError");
      assert.equal((yield* calls).length, 1);
      assert.equal((yield* storedRow).accessToken, "shpat_old");
    }),
  ),
  behavior(
    "37",
    "exchange 503 then 200: succeeds",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([
        { route: "token", status: 503, body: { error: "down" } },
      ]);
      yield* authenticate;
      assert.equal((yield* calls).length, 2);
      assert.equal((yield* storedRow).accessToken, "shpat_1");
      yield* assertInvariant;
    }),
  ),
  behavior(
    "37",
    "exchange 503 every time: ShopifyUnavailableError",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script(
        Array.from({ length: 3 }, () => ({
          route: "token" as const,
          status: 503,
          body: { error: "down" },
        })),
      );
      assert.equal(yield* failureOf(authenticate), "ShopifyUnavailableError");
      assert.equal((yield* calls).length, 3);
    }),
    { timeout: 8000 },
  ),
  ...["refresh_token_expires_in", "scope"].map((missing) =>
    behavior(
      "38",
      `an exchange response without ${missing}: a defect; row unchanged`,
      Effect.gen(function* () {
        yield* seedAt();
        const before = yield* storedRow;
        yield* (yield* ShopifyFake).script([
          { route: "token", body: grantBody({ [missing]: undefined }) },
        ]);
        yield* assertDefect(authenticate);
        assert.deepEqual(yield* storedRow, before);
      }),
    ),
  ),
  behavior(
    "50",
    "a reinstall after an uninstall exchanges and writes the row",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      yield* seedAt();
      yield* harness.uninstall(SHOP);
      assert.ok(Option.isNone(yield* stored));
      assert.deepEqual(yield* authenticate, { shop: SHOP, shopGid: FAKE_SHOP_GID });
      assert.deepEqual(grantsOf(yield* calls), [TOKEN_EXCHANGE_GRANT, "graphql"]);
      assert.equal((yield* storedRow).accessToken, "shpat_1");
      yield* assertInvariant;
    }),
  ),
];

/**
 * Answers the token call numbered `index` among every call `delayMs` late, past
 * `GRANT_ATTEMPT_DEADLINE`, with `reply`, given what the fake would answer then; every other
 * call as the fake would. Records when each token call arrived and when the late one settled.
 */
const lateTokenCall = (options: {
  readonly index: number;
  readonly delayMs: number;
  readonly reply?: (answer: () => Promise<Response>) => Promise<Response>;
}) =>
  Effect.gen(function* () {
    const fake = yield* ShopifyFake;
    // oxlint-disable-next-line typescript/no-invalid-void-type -- a signal that carries no value
    const settled = yield* Deferred.make<void>();
    const sentAt: number[] = [];
    let settledAt = Infinity;
    const reply = options.reply ?? ((answer) => answer());
    yield* fake.intercept((call, attempt, answer) => {
      if (call.route === "token") sentAt.push(performance.now());
      if (attempt !== options.index) return answer();
      return new Promise((resolve) => {
        setTimeout(resolve, options.delayMs);
      })
        .then(() => reply(answer))
        .finally(() => {
          settledAt = performance.now();
          Effect.runSync(Deferred.succeed(settled, undefined));
        });
    });
    return {
      settled: Deferred.await(settled),
      sentAt: () => [...sentAt],
      settledAt: () => settledAt,
    };
  });

/** Past `GRANT_ATTEMPT_DEADLINE` (5 s) but within it and `GRANT_SETTLE_LIMIT` (3 s) after. */
const LATE_MS = 6000;

/**
 * An attempt abandoned at its deadline may still complete at Shopify: case 51. The library cannot
 * cancel it, so the next request waits for it, up to `GRANT_SETTLE_LIMIT`.
 */
const abandonedAttempts: readonly RequiredBehavior[] = [
  behavior(
    "51",
    "an exchange attempt past its deadline that then succeeds: its pair is adopted, with no second exchange",
    Effect.gen(function* () {
      yield* seedAt();
      const late = yield* lateTokenCall({ index: 0, delayMs: LATE_MS });
      yield* authenticate;
      yield* late.settled;
      assert.deepEqual(grantsOf(yield* calls), [TOKEN_EXCHANGE_GRANT]);
      assert.equal((yield* storedRow).accessToken, "shpat_1");
      yield* assertInvariant;
    }),
    { needs: interleave, timeout: 15_000 },
  ),
  behavior(
    "51",
    "a refresh attempt past its deadline that then succeeds: its pair is adopted, with no second refresh",
    Effect.gen(function* () {
      yield* seedAt();
      const late = yield* lateTokenCall({ index: 0, delayMs: LATE_MS });
      assert.equal((yield* ensure).accessToken, "shpat_1");
      yield* late.settled;
      assert.deepEqual(grantsOf(yield* calls), [REFRESH_GRANT]);
      assert.equal((yield* storedRow).refreshToken, "shprt_1");
      yield* assertInvariant;
    }),
    { needs: interleave, timeout: 15_000 },
  ),
  behavior(
    "51",
    "an abandoned attempt that never settles: the retry is sent once GRANT_SETTLE_LIMIT passes, and the grant ends in bounded time",
    Effect.gen(function* () {
      yield* seedAt();
      yield* lateTokenCall({
        index: 0,
        delayMs: 0,
        reply: () =>
          new Promise<never>(() => {
            // Never settles.
          }),
      });
      const begun = performance.now();
      assert.equal((yield* ensure).accessToken, "shpat_1");
      const elapsed = performance.now() - begun;
      assert.deepEqual(grantsOf(yield* calls), [REFRESH_GRANT, REFRESH_GRANT]);
      assert.ok(elapsed >= 8000, `the retry waited out the limit (${String(elapsed)} ms)`);
      assert.ok(elapsed < 10_000, `the wait is bounded (${String(elapsed)} ms)`);
      yield* assertInvariant;
    }),
    { needs: interleave, timeout: 15_000 },
  ),
  behavior(
    "51",
    "an abandoned attempt that fails: the retry is sent once it has settled",
    Effect.gen(function* () {
      yield* seedAt();
      const late = yield* lateTokenCall({
        index: 0,
        delayMs: LATE_MS,
        reply: () => Promise.resolve(Response.json({ error: "down" }, { status: 503 })),
      });
      assert.equal((yield* ensure).accessToken, "shpat_1");
      const sentAt = late.sentAt();
      assert.equal(sentAt.length, 2);
      assert.ok((sentAt[1] ?? 0) >= late.settledAt(), "the retry follows the abandoned attempt");
      yield* assertInvariant;
    }),
    { needs: interleave, timeout: 15_000 },
  ),
  behavior(
    "51",
    "a grant arriving while an earlier grant's last attempt is unsettled: it waits and adopts that attempt's pair; no request overlaps it",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script(
        Array.from({ length: 2 }, () => ({
          route: "token" as const,
          status: 503,
          body: { error: "down" },
        })),
      );
      const late = yield* lateTokenCall({ index: 2, delayMs: 7000 });
      assert.equal(yield* failureOf(ensure), "ShopifyUnavailableError");
      assert.equal(late.settledAt(), Infinity, "the abandoned attempt is still unsettled");
      assert.equal((yield* ensure).accessToken, "shpat_1");
      assert.deepEqual(grantsOf(yield* calls), [REFRESH_GRANT, REFRESH_GRANT, REFRESH_GRANT]);
      assert.equal((yield* storedRow).refreshToken, "shprt_1");
      yield* assertInvariant;
    }),
    { needs: interleave, timeout: 20_000 },
  ),
];

/** A stored token with an hour left: an Admin call needs no grant first. */
const seedFresh = Effect.gen(function* () {
  yield* seedAt({
    accessTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.hours(1)),
  });
});

/** `adminGraphql`: cases 39–45. */
const admin: readonly RequiredBehavior[] = [
  behavior(
    "39",
    "decodes data with the caller's schema",
    Effect.gen(function* () {
      yield* seedFresh;
      assert.deepEqual(yield* adminGraphql, { shop: { id: FAKE_SHOP_GID } });
      assert.equal((yield* calls).length, 1);
    }),
  ),
  behavior(
    "39",
    "data that does not decode is a defect",
    Effect.gen(function* () {
      yield* seedFresh;
      yield* (yield* ShopifyFake).script([{ route: "graphql", body: { data: { shop: {} } } }]);
      yield* assertDefect(adminGraphql);
    }),
  ),
  behavior(
    "39",
    "a 401: the grantor is asked for a token other than the rejected one, and the call retried once",
    Effect.gen(function* () {
      yield* seedFresh;
      yield* (yield* ShopifyFake).script([
        { route: "graphql", status: 401, body: { errors: "Unauthorized" } },
      ]);
      assert.deepEqual(yield* adminGraphql, { shop: { id: FAKE_SHOP_GID } });
      assert.deepEqual(grantsOf(yield* calls), ["graphql", REFRESH_GRANT, "graphql"]);
      assert.equal((yield* storedRow).accessToken, "shpat_1");
      yield* assertInvariant;
    }),
  ),
  behavior(
    "39",
    "a second 401 is ShopifyUnavailableError, and the refreshed pair stays for a later call",
    Effect.gen(function* () {
      yield* seedFresh;
      yield* (yield* ShopifyFake).script(
        Array.from({ length: 2 }, () => ({
          route: "graphql" as const,
          status: 401,
          body: { errors: "Unauthorized" },
        })),
      );
      assert.equal(yield* failureOf(adminGraphql), "ShopifyUnavailableError");
      assert.equal((yield* calls).length, 3);
      assert.equal((yield* storedRow).refreshToken, "shprt_1");
    }),
  ),
  behavior(
    "40",
    "a 401 after a refresh stored a new token: the call is retried with it, with no grant",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      const fake = yield* ShopifyFake;
      const now = yield* DateTime.now;
      yield* seedFresh;
      const raced = rowAt(now, {
        accessToken: "shpat_raced",
        accessTokenExpiresAt: DateTime.addDuration(now, Duration.hours(1)),
        refreshToken: "shprt_raced",
      });
      yield* fake.intercept((call, attempt, answer) =>
        call.route === "graphql" && attempt === 0
          ? Effect.runPromise(harness.seed(raced)).then(() =>
              Response.json({ errors: "Unauthorized" }, { status: 401 }),
            )
          : answer(),
      );
      assert.deepEqual(yield* adminGraphql, { shop: { id: FAKE_SHOP_GID } });
      assert.deepEqual(grantsOf(yield* calls), ["graphql", "graphql"]);
      assert.equal((yield* storedRow).accessToken, "shpat_raced");
    }),
    { needs: interleave },
  ),
  ...["THROTTLED", "INTERNAL_SERVER_ERROR"].map((code) =>
    behavior(
      "41",
      `${code}: ShopifyUnavailableError`,
      Effect.gen(function* () {
        yield* seedFresh;
        yield* (yield* ShopifyFake).script([
          { route: "graphql", body: { errors: [{ message: code, extensions: { code } }] } },
        ]);
        assert.equal(yield* failureOf(adminGraphql), "ShopifyUnavailableError");
      }),
    ),
  ),
  behavior(
    "42",
    "ACCESS_DENIED: AccessDeniedError",
    Effect.gen(function* () {
      yield* seedFresh;
      yield* (yield* ShopifyFake).script([
        {
          route: "graphql",
          body: { errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] },
        },
      ]);
      assert.equal(yield* failureOf(adminGraphql), "AccessDeniedError");
    }),
  ),
  ...[402, 423, 403].map((status) =>
    behavior(
      "43",
      `${String(status)}: ShopInaccessibleError with that status`,
      Effect.gen(function* () {
        yield* seedFresh;
        yield* (yield* ShopifyFake).script([
          { route: "graphql", status, body: { errors: "refused" } },
        ]);
        const error = yield* Effect.flip(adminGraphql);
        assert.equal(error._tag, "ShopInaccessibleError");
        assert.equal("status" in error ? error.status : undefined, status);
      }),
    ),
  ),
  behavior(
    "44",
    "a GraphQL syntax error: a defect",
    Effect.gen(function* () {
      yield* seedFresh;
      yield* (yield* ShopifyFake).script([
        {
          route: "graphql",
          body: {
            errors: [{ message: "syntax error", extensions: { code: "GRAPHQL_PARSE_FAILED" } }],
          },
        },
      ]);
      yield* assertDefect(adminGraphql);
    }),
  ),
  behavior(
    "45",
    "a mutation failing transiently: called once",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      yield* seedFresh;
      yield* (yield* ShopifyFake).script([
        { route: "graphql", status: 503, body: { errors: "down" } },
      ]);
      assert.equal(
        yield* failureOf(harness.adminGraphql(SHOP, "mutation Touch { shop { id } }")),
        "ShopifyUnavailableError",
      );
      assert.equal((yield* calls).length, 1);
    }),
  ),
];

/**
 * Every authentication case: `ensureSession` (9–14, 17, 18, 20–24, 26, 27, 49), the merchant
 * path (28, 29, 31–38, 50), abandoned grant attempts (51) and `adminGraphql` (39–45). Webhooks (46–48) arrive with `Webhooks`.
 */
export const AUTH_BEHAVIORS: readonly RequiredBehavior[] = [
  ...ensureWithoutGrant,
  ...ensureRefreshing,
  ...ensureInFlight,
  ...merchantPath,
  ...abandonedAttempts,
  ...admin,
];
