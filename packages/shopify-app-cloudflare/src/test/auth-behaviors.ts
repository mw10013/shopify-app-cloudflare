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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { ShopDomain, ShopGid } from "#internal/domain.ts";

import { FAKE_APP_TOKEN_KID } from "./fake-app.ts";
import { mintIdToken } from "./id-token.ts";
import type { PartnerFake } from "./partner-fake.ts";
import { FAKE_SHOP_GID, ShopifyFake, type ShopifyFakeCall } from "./shopify-fake.ts";
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
  readonly run: Effect.Effect<void, unknown, ShopifyHarness | ShopifyFake | PartnerFake>;
}

/** The shop every case runs against. */
export const BEHAVIOR_SHOP = Schema.decodeUnknownSync(ShopDomain)("behavior-shop.myshopify.com");

/** The seeded shop's id; a first install fetches `FAKE_SHOP_GID` instead. */
export const BEHAVIOR_SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/1");

const SHOP = BEHAVIOR_SHOP;

/** The scope a seeded installation granted. */
const SEEDED_SCOPE = "read_orders";

/** An installed shop whose stored access token expired a second before `now`. */
export const rowAt = (
  now: DateTime.Utc,
  over: Partial<SeedInstallation> = {},
): SeedInstallation => ({
  shop: SHOP,
  shopGid: BEHAVIOR_SHOP_GID,
  scope: SEEDED_SCOPE,
  accessToken: "shpat_old",
  accessTokenExpiresAt: DateTime.subtractDuration(now, Duration.seconds(1)),
  ...over,
});

/** Seeds {@link rowAt} the current time, with `over`. */
export const seedAt = (over: Partial<SeedInstallation> = {}) =>
  Effect.gen(function* () {
    const harness = yield* ShopifyHarness;
    yield* harness.seed(rowAt(yield* DateTime.now, over));
  });

/** A stored token with half its life left, as an earlier mint left it: no mint first. */
const seedFresh = Effect.gen(function* () {
  yield* seedAt({
    accessTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.minutes(30)),
  });
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

export const stored = Effect.flatMap(ShopifyHarness, (harness) => harness.stored(SHOP));
export const storedRow = Effect.map(stored, (row) => {
  assert.ok(Option.isSome(row), "the shop has a row");
  return row.value;
});

const calls = Effect.flatMap(ShopifyFake, (shopify) => shopify.calls);
const mints = Effect.map(calls, (made) => made.filter((call) => call.route === "token"));

/** Each call's route, in order. */
const routesOf = (made: readonly ShopifyFakeCall[]) => made.map((call) => call.route);

/** The lines logged at `level` whose message starts with `prefix`. */
export const logged = (level: string, prefix: string) =>
  Effect.map(
    Effect.flatMap(ShopifyHarness, (harness) => harness.logs),
    (lines) => lines.filter((line) => line.level === level && line.message.startsWith(prefix)),
  );

const accepted = (accessToken: string) =>
  Effect.flatMap(ShopifyFake, (shopify) => shopify.accepts(SHOP, accessToken));

const verdict = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "unknown";

export const failureOf = <R>(effect: Effect.Effect<unknown, unknown, R>) =>
  Effect.map(Effect.flip(effect), verdict);

export const assertDefect = <R>(effect: Effect.Effect<unknown, unknown, R>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause), "expected a defect");
  });

/** Succeeds once the fake has served `count` calls. */
const callsReach = (count: number) =>
  Effect.gen(function* () {
    while ((yield* calls).length < count) yield* Effect.sleep("10 millis");
  });

/**
 * A gate the fake's intercept awaits: a promise, since the intercept runs outside any fiber.
 * `open` lets every waiting call through.
 */
const makeGate = Effect.sync(() => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    wait: () => opened,
    open: Effect.sync(() => {
      open();
    }),
  };
});

/**
 * Runs `first` and `second` together with every mint held until both have reached the token
 * endpoint, then lets them through: two callers in flight at once.
 */
const together = <A, B, E1, E2, R1, R2>(
  first: Effect.Effect<A, E1, R1>,
  second: Effect.Effect<B, E2, R2>,
) =>
  Effect.gen(function* () {
    const shopify = yield* ShopifyFake;
    const gate = yield* makeGate;
    yield* shopify.intercept((call, _attempt, answer) =>
      call.route === "token" ? gate.wait().then(answer) : answer(),
    );
    const [a, b] = yield* Effect.all(
      [
        first,
        Effect.andThen(callsReach(1), second),
        Effect.gen(function* () {
          yield* callsReach(2);
          yield* gate.open;
        }),
      ],
      { concurrency: "unbounded" },
    );
    return [a, b] as const;
  });

const interleave: readonly HarnessCapability[] = ["interleave"];

export const behavior = (
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

const down = (status: number) => ({ route: "token" as const, status, body: { error: "down" } });

/** Minting, through `ensureSession` on a stale token: cases 4–11. */
const minting: readonly RequiredBehavior[] = [
  behavior(
    "4",
    "a mint signs a fresh assertion the fake accepts; its request carries no client secret and no scope",
    Effect.gen(function* () {
      yield* seedAt();
      const session = yield* ensure;
      assert.ok(yield* accepted(session.accessToken), "Shopify accepts the minted token");
      const [mint, ...rest] = yield* mints;
      assert.equal(rest.length, 0);
      assert.deepEqual(mint?.fields, [
        "client_assertion",
        "client_assertion_type",
        "client_id",
        "grant_type",
      ]);
    }),
  ),
  ...[503, 429].map((status) =>
    behavior(
      "5",
      `mint ${String(status)} then 200: retried with a new jti; succeeds`,
      Effect.gen(function* () {
        yield* seedAt();
        yield* (yield* ShopifyFake).script([down(status)]);
        assert.ok(yield* accepted((yield* ensure).accessToken));
        const [first, second, ...rest] = yield* mints;
        assert.equal(rest.length, 0);
        assert.ok(first?.jti !== undefined && first.jti !== second?.jti, "a new jti");
      }),
    ),
  ),
  behavior(
    "5",
    "a network error, then 200: retried; succeeds",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([{ route: "token", networkError: true }]);
      assert.ok(yield* accepted((yield* ensure).accessToken));
      assert.equal((yield* mints).length, 2);
    }),
  ),
  behavior(
    "6",
    "mint 503 every time: ShopifyUnavailableError after MINT_TRANSIENT_RETRIES retries",
    Effect.gen(function* () {
      yield* seedAt();
      const before = yield* storedRow;
      yield* (yield* ShopifyFake).script(Array.from({ length: 3 }, () => down(503)));
      assert.equal(yield* failureOf(ensure), "ShopifyUnavailableError");
      assert.equal((yield* mints).length, 3);
      assert.deepEqual(yield* storedRow, before);
    }),
    { timeout: 8000 },
  ),
  ...[400, 401, 502].map((status) =>
    behavior(
      "7",
      `a mint ${String(status)} whose body is not JSON: transient`,
      Effect.gen(function* () {
        yield* seedAt();
        yield* (yield* ShopifyFake).script([
          { route: "token", status, text: "<html>outage</html>" },
        ]);
        assert.ok(yield* accepted((yield* ensure).accessToken));
        assert.equal((yield* mints).length, 2);
      }),
    ),
  ),
  behavior(
    "8",
    "a mint attempt that hangs: abandoned at MINT_ATTEMPT_DEADLINE and retried, in bounded time",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([{ route: "token", hang: true }]);
      const begun = performance.now();
      assert.ok(yield* accepted((yield* ensure).accessToken));
      const elapsed = performance.now() - begun;
      assert.equal((yield* mints).length, 2);
      assert.ok(elapsed < 8000, `bounded (${String(elapsed)} ms)`);
    }),
    { timeout: 12_000 },
  ),
  behavior(
    "9",
    "mint 401 (a key the fake does not hold): a defect after one call, logged at Error",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).revokeKey(FAKE_APP_TOKEN_KID);
      yield* assertDefect(ensure);
      assert.equal((yield* mints).length, 1);
      assert.equal(
        (yield* logged("Error", `AppTokens.mint: shop=${SHOP} status=refused`)).length,
        1,
      );
    }),
  ),
  behavior(
    "10",
    "mint 400 app_not_installed: AppNotInstalledError",
    Effect.gen(function* () {
      yield* seedAt({ installed: false });
      assert.equal(yield* failureOf(ensure), "AppNotInstalledError");
      assert.equal((yield* mints).length, 1);
    }),
  ),
  behavior(
    "10",
    "mint 404: AppNotInstalledError",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script([
        { route: "token", status: 404, body: { errors: "Not Found" } },
      ]);
      assert.equal(yield* failureOf(ensure), "AppNotInstalledError");
      assert.equal((yield* mints).length, 1);
    }),
  ),
  ...(["expires_in", "scope"] as const).map((missing) =>
    behavior(
      "11",
      `a mint response without ${missing}: a defect; row unchanged`,
      Effect.gen(function* () {
        yield* seedAt();
        const before = yield* storedRow;
        const { [missing]: _dropped, ...body } = {
          access_token: "shpat_partial",
          expires_in: 3599,
          scope: SEEDED_SCOPE,
        };
        yield* (yield* ShopifyFake).script([{ route: "token", body }]);
        yield* assertDefect(ensure);
        assert.equal((yield* mints).length, 1);
        assert.deepEqual(yield* storedRow, before);
      }),
    ),
  ),
];

/** `ensureSession`: cases 12–18. */
const background: readonly RequiredBehavior[] = [
  behavior(
    "12",
    "a fresh token: answered with no mint",
    Effect.gen(function* () {
      yield* seedFresh;
      assert.equal((yield* ensure).accessToken, "shpat_old");
      assert.equal((yield* calls).length, 0);
    }),
  ),
  behavior(
    "12",
    "a token within BACKGROUND_ACCESS_TOKEN_BUFFER of its expiry, as TestClock crosses it: one mint",
    Effect.gen(function* () {
      yield* seedAt({
        accessTokenExpiresAt: DateTime.addDuration(yield* DateTime.now, Duration.minutes(6)),
      });
      yield* ensure;
      assert.equal((yield* calls).length, 0);
      yield* TestClock.adjust("61 seconds");
      assert.notEqual((yield* ensure).accessToken, "shpat_old");
      assert.equal((yield* mints).length, 1);
    }),
    { needs: ["clock"] },
  ),
  behavior(
    "13",
    "no row: AppNotInstalledError, no mint",
    Effect.gen(function* () {
      assert.equal(yield* failureOf(ensure), "AppNotInstalledError");
      assert.equal((yield* calls).length, 0);
    }),
  ),
  behavior(
    "14",
    "a stale token: one mint; the row holds the new token",
    Effect.gen(function* () {
      yield* seedAt();
      const session = yield* ensure;
      assert.equal((yield* mints).length, 1);
      const row = yield* storedRow;
      assert.equal(row.accessToken, session.accessToken);
      assert.notEqual(row.accessToken, "shpat_old");
      assert.equal(row.scope, SEEDED_SCOPE, "the scope the mint reported");
      assert.ok(
        row.accessTokenExpiresAt !== null &&
          DateTime.isLessThan(yield* DateTime.now, row.accessTokenExpiresAt),
      );
    }),
  ),
  behavior(
    "15",
    "two concurrent callers on a stale token: both answer a token the fake accepts; the row holds the one that expires later",
    Effect.gen(function* () {
      yield* seedAt();
      const [first, second] = yield* together(ensure, ensure);
      assert.ok(yield* accepted(first.accessToken));
      assert.ok(yield* accepted(second.accessToken));
      const later = DateTime.max(first.accessTokenExpiresAt, second.accessTokenExpiresAt);
      assert.deepEqual((yield* storedRow).accessTokenExpiresAt, later);
    }),
    { needs: interleave },
  ),
  behavior(
    "17",
    "a row whose shop the fake has uninstalled: AppNotInstalledError, logged status=orphaned; row unchanged",
    Effect.gen(function* () {
      yield* seedAt({ installed: false });
      const before = yield* storedRow;
      assert.equal(yield* failureOf(ensure), "AppNotInstalledError");
      assert.equal(
        (yield* logged("Warn", `Shopify.ensureSession: shop=${SHOP} status=orphaned`)).length,
        1,
      );
      assert.deepEqual(yield* storedRow, before);
    }),
  ),
  ...(
    [
      ["after Shopify answered", true],
      ["before Shopify answered", false],
    ] as const
  ).map(([when, answeredFirst]) =>
    behavior(
      "18",
      `an uninstall during a mint, ${when}: no row afterwards, and the caller fails AppNotInstalledError`,
      Effect.gen(function* () {
        const harness = yield* ShopifyHarness;
        yield* seedAt();
        const uninstall = () => Effect.runPromise(harness.uninstall(SHOP));
        yield* (yield* ShopifyFake).intercept(async (call, _attempt, answer) => {
          if (call.route !== "token") return answer();
          if (!answeredFirst) return uninstall().then(answer);
          const response = await answer();
          await uninstall();
          return response;
        });
        assert.equal(yield* failureOf(ensure), "AppNotInstalledError");
        assert.ok(Option.isNone(yield* stored));
      }),
      { needs: interleave },
    ),
  ),
];

/** The merchant path, through the merchant gate: cases 19–26. */
const merchant: readonly RequiredBehavior[] = [
  behavior(
    "19",
    "a fresh stored token: no mint",
    Effect.gen(function* () {
      yield* seedFresh;
      assert.deepEqual(yield* authenticate, { shop: SHOP, shopGid: BEHAVIOR_SHOP_GID });
      assert.equal((yield* calls).length, 0);
    }),
  ),
  behavior(
    "20",
    "a first install (no row): one mint, one shopGid fetch, one row",
    Effect.gen(function* () {
      yield* (yield* ShopifyFake).install(SHOP);
      assert.deepEqual(yield* authenticate, { shop: SHOP, shopGid: FAKE_SHOP_GID });
      assert.deepEqual(routesOf(yield* calls), ["token", "graphql"]);
      const row = yield* storedRow;
      assert.equal(row.shopGid, FAKE_SHOP_GID);
      assert.ok(row.accessToken !== null && (yield* accepted(row.accessToken)));
      assert.equal(
        (yield* logged("Info", `Shopify.authenticateMerchant: shop=${SHOP} status=installed`))
          .length,
        1,
      );
    }),
  ),
  behavior(
    "21",
    "two concurrent first installs: one row; both merchants answered",
    Effect.gen(function* () {
      yield* (yield* ShopifyFake).install(SHOP);
      const [first, second] = yield* together(authenticate, authenticate);
      assert.deepEqual(first, { shop: SHOP, shopGid: FAKE_SHOP_GID });
      assert.deepEqual(second, first);
      assert.equal((yield* storedRow).shopGid, FAKE_SHOP_GID);
    }),
    { needs: interleave },
  ),
  behavior(
    "22",
    "a reinstall after an uninstall mints and writes the row",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      yield* seedAt();
      yield* harness.uninstall(SHOP);
      assert.ok(Option.isNone(yield* stored));
      yield* (yield* ShopifyFake).install(SHOP);
      assert.deepEqual(yield* authenticate, { shop: SHOP, shopGid: FAKE_SHOP_GID });
      assert.deepEqual(routesOf(yield* calls), ["token", "graphql"]);
      const row = yield* storedRow;
      assert.ok(row.accessToken !== null && (yield* accepted(row.accessToken)));
    }),
  ),
  behavior(
    "23",
    "a mint answering app_not_installed: ShopifyUnavailableError, no row",
    Effect.gen(function* () {
      assert.equal(yield* failureOf(authenticate), "ShopifyUnavailableError");
      assert.equal((yield* mints).length, 1);
      assert.ok(Option.isNone(yield* stored));
    }),
  ),
  behavior(
    "24",
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
    "25",
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
    "26",
    "a mint 503 every time: ShopifyUnavailableError",
    Effect.gen(function* () {
      yield* seedAt();
      yield* (yield* ShopifyFake).script(Array.from({ length: 3 }, () => down(503)));
      assert.equal(yield* failureOf(authenticate), "ShopifyUnavailableError");
      assert.equal((yield* mints).length, 3);
    }),
    { timeout: 8000 },
  ),
];

const unauthorized = { route: "graphql" as const, status: 401, body: { errors: "Unauthorized" } };

/** `adminGraphql`: cases 27–33. */
const admin: readonly RequiredBehavior[] = [
  behavior(
    "27",
    "a 401: a token other than the rejected one is minted, and the call retried once",
    Effect.gen(function* () {
      yield* seedFresh;
      yield* (yield* ShopifyFake).script([unauthorized]);
      assert.deepEqual(yield* adminGraphql, { shop: { id: FAKE_SHOP_GID } });
      const made = yield* calls;
      assert.deepEqual(routesOf(made), ["graphql", "token", "graphql"]);
      assert.equal(made[0]?.accessToken, "shpat_old");
      assert.notEqual(made[2]?.accessToken, "shpat_old");
      assert.equal((yield* storedRow).accessToken, made[2]?.accessToken);
    }),
  ),
  behavior(
    "27",
    "a second 401: ShopifyUnavailableError",
    Effect.gen(function* () {
      yield* seedFresh;
      yield* (yield* ShopifyFake).script([unauthorized, unauthorized]);
      assert.equal(yield* failureOf(adminGraphql), "ShopifyUnavailableError");
      assert.deepEqual(routesOf(yield* calls), ["graphql", "token", "graphql"]);
    }),
  ),
  behavior(
    "28",
    "a 401 after another caller stored a new token: the call is retried with it, with no mint",
    Effect.gen(function* () {
      const harness = yield* ShopifyHarness;
      const shopify = yield* ShopifyFake;
      const now = yield* DateTime.now;
      yield* seedFresh;
      const raced = rowAt(now, {
        accessToken: "shpat_raced",
        accessTokenExpiresAt: DateTime.addDuration(now, Duration.hours(2)),
      });
      yield* shopify.intercept((call, attempt, answer) =>
        call.route === "graphql" && attempt === 0
          ? Effect.runPromise(harness.seed(raced)).then(() =>
              Response.json({ errors: "Unauthorized" }, { status: 401 }),
            )
          : answer(),
      );
      assert.deepEqual(yield* adminGraphql, { shop: { id: FAKE_SHOP_GID } });
      const made = yield* calls;
      assert.deepEqual(routesOf(made), ["graphql", "graphql"]);
      assert.equal(made[1]?.accessToken, "shpat_raced");
    }),
    { needs: interleave },
  ),
  ...["THROTTLED", "INTERNAL_SERVER_ERROR"].map((code) =>
    behavior(
      "29",
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
    "30",
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
      "31",
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
    "32",
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
    "33",
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
 * Every authentication case: minting (4–11), `ensureSession` (12–18), the merchant path through
 * the merchant gate (19–26) and `adminGraphql` (27–33). The repository's (1–3) are the store's
 * own tests; webhooks (34–36) are in `APP_BEHAVIORS`.
 */
export const AUTH_BEHAVIORS: readonly RequiredBehavior[] = [
  ...minting,
  ...background,
  ...merchant,
  ...admin,
];
