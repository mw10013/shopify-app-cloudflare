import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import {
  Auth,
  OrphanInstalledError,
  SentMail,
  serveAdmin,
  SignInLimiter,
  signInMethods,
  siteAuthControlHandlers,
} from "@mw10013/shopify-app-cloudflare/backend";
import {
  Email,
  SignInCodeRequested,
  SiteAuthControlRpcs,
} from "@mw10013/shopify-app-cloudflare/contract";
import { D1Test, SiteAuthTest } from "@mw10013/shopify-app-cloudflare/test/node";
import { getMigrations } from "better-auth/db/migration";
import { admin, emailOTP } from "better-auth/plugins";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Schema from "effect/Schema";

const email = Schema.decodeUnknownSync(Email);
const decodeRequested = Schema.decodeUnknownSync(SignInCodeRequested);

const ADMIN = email("admin@site.test");
const USER = email("user@site.test");
const STRANGER = email("stranger@site.test");
const INVITED = email("invited@site.test");

const SEEDED = [
  { email: ADMIN, role: "admin" as const },
  { email: USER, role: "user" as const },
];

const NO_REQUEST = { cookie: undefined, ip: undefined };

const requestCode = (address: Email, ip?: string) =>
  Effect.flatMap(signInMethods, (methods) =>
    methods.requestSignInCode({ cookie: undefined, ip }, { email: address }),
  );

const codeOf = (answer: unknown) => decodeRequested(answer).code;

const userRows = (address: Email) =>
  Effect.map(D1Test, ({ sqlite }) =>
    sqlite.prepare("select email, role from user where email = ?").all(address),
  );

/** What crossed: the failure's value as the caller would receive it. */
const crossed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    assert.isTrue(Exit.isFailure(exit));
    return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  });

describe("the Better Auth migration", () => {
  it.live("creates every table and column Better Auth's own migration would, and no other", () =>
    Effect.gen(function* () {
      const { database } = yield* D1Test;
      const migrations = yield* Effect.promise(() =>
        getMigrations({
          database,
          secret: "migration-check-migration-check-migration",
          telemetry: { enabled: false },
          plugins: [emailOTP({ sendVerificationOTP: () => Promise.resolve() }), admin()],
        }),
      );
      assert.deepStrictEqual(migrations.toBeCreated, []);
      assert.deepStrictEqual(migrations.toBeAdded, []);
    }).pipe(Effect.provide(D1Test.layer())),
  );
});

describe("sign-up closed", () => {
  const layer = () => SiteAuthTest.layer({ users: SEEDED });

  it.live("a seeded admin gets a code under inline delivery, and the code signs it in", () =>
    Effect.gen(function* () {
      const cookie = yield* SiteAuthTest.signIn(ADMIN);
      const auth = yield* Auth;
      const { user } = yield* auth.session(cookie);
      assert.strictEqual(user.email, ADMIN);
      assert.strictEqual(user.role, "admin");
    }).pipe(Effect.provide(layer())),
  );

  it.live("an unknown address gets the same answer without a code, and no user is made", () =>
    Effect.gen(function* () {
      assert.isTrue(Option.isNone(codeOf(yield* requestCode(STRANGER))));
      assert.deepStrictEqual(yield* userRows(STRANGER), []);
    }).pipe(Effect.provide(layer())),
  );

  it.live("a code issued past the rule for an unknown address signs no one in or up", () =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const code = yield* auth.issueSignInCode(STRANGER);
      const response = yield* SiteAuthTest.verify(STRANGER, code);
      assert.strictEqual(response.status, 403);
      assert.deepStrictEqual(yield* userRows(STRANGER), []);
    }).pipe(Effect.provide(layer())),
  );
});

describe("sign-up by an effectful rule", () => {
  const layer = () =>
    SiteAuthTest.layer({
      users: SEEDED,
      signUp: (address) => Effect.succeed(address === INVITED),
    });

  it.live("an address the rule admits gets a code, and its first sign-in makes a user", () =>
    Effect.gen(function* () {
      const cookie = yield* SiteAuthTest.signIn(INVITED);
      const { user } = yield* (yield* Auth).session(cookie);
      assert.strictEqual(user.role, "user");
      assert.deepStrictEqual(yield* userRows(INVITED), [{ email: INVITED, role: "user" }]);
    }).pipe(Effect.provide(layer())),
  );

  it.live("an address the rule refuses gets no code", () =>
    Effect.gen(function* () {
      assert.isTrue(Option.isNone(codeOf(yield* requestCode(STRANGER))));
    }).pipe(Effect.provide(layer())),
  );

  it.live(
    "the rule holds at user creation too: a code issued for a refused address makes no user",
    () =>
      Effect.gen(function* () {
        const code = yield* (yield* Auth).issueSignInCode(STRANGER);
        assert.strictEqual((yield* SiteAuthTest.verify(STRANGER, code)).status, 403);
        assert.deepStrictEqual(yield* userRows(STRANGER), []);
      }).pipe(Effect.provide(layer())),
  );

  it.live("the app's own create hook runs after the rule admits", () =>
    Effect.gen(function* () {
      const created = yield* Ref.make<readonly string[]>([]);
      yield* SiteAuthTest.signIn(INVITED).pipe(
        Effect.provide(
          SiteAuthTest.layer({
            signUp: (address) => Effect.succeed(address === INVITED),
            databaseHooks: (run) => ({
              user: {
                create: {
                  before: (user) => run(Ref.update(created, (emails) => [...emails, user.email])),
                },
              },
            }),
          }),
        ),
      );
      assert.deepStrictEqual(yield* Ref.get(created), [INVITED]);
    }),
  );
});

describe("the sign-in code", () => {
  const layer = () => SiteAuthTest.layer({ users: SEEDED });

  it.live("is six digits and stored hashed", () =>
    Effect.gen(function* () {
      const code = Option.getOrThrow(codeOf(yield* requestCode(ADMIN)));
      assert.match(code, /^[0-9]{6}$/u);
      const { sqlite } = yield* D1Test;
      const values = sqlite.prepare("select value from verification").all();
      assert.lengthOf(values, 1);
      assert.notInclude(String(values[0]?.value), code);
    }).pipe(Effect.provide(layer())),
  );

  it.live("a wrong code is refused, and after three wrong guesses the right one is spent too", () =>
    Effect.gen(function* () {
      const code = Option.getOrThrow(codeOf(yield* requestCode(ADMIN)));
      const wrong = code === "000000" ? "111111" : "000000";
      for (const _ of [1, 2, 3])
        assert.strictEqual((yield* SiteAuthTest.verify(ADMIN, wrong)).status, 400);
      const last = yield* SiteAuthTest.verify(ADMIN, code);
      assert.isFalse(last.ok);
      const body = (yield* Effect.promise(() => last.json())) as { readonly code?: string };
      assert.strictEqual(body.code, "TOO_MANY_ATTEMPTS");
    }).pipe(Effect.provide(layer())),
  );

  it.live("a newer code replaces the older one", () =>
    Effect.gen(function* () {
      const first = Option.getOrThrow(codeOf(yield* requestCode(ADMIN)));
      const second = Option.getOrThrow(codeOf(yield* requestCode(ADMIN)));
      if (first !== second)
        assert.strictEqual((yield* SiteAuthTest.verify(ADMIN, first)).status, 400);
      assert.isTrue((yield* SiteAuthTest.verify(ADMIN, second)).ok);
    }).pipe(Effect.provide(layer())),
  );

  it.live("sign-out ends the session", () =>
    Effect.gen(function* () {
      const cookie = yield* SiteAuthTest.signIn(ADMIN);
      const response = yield* SiteAuthTest.serve(SiteAuthTest.authRequest("/sign-out", {}, cookie));
      assert.isTrue(response.ok);
      const failure = yield* crossed((yield* Auth).session(cookie));
      assert.strictEqual((failure as { readonly _tag: string })._tag, "UnauthorizedError");
    }).pipe(Effect.provide(layer())),
  );

  it.live(
    "Auth.serve answers 404 for every Better Auth endpoint but the code check and sign-out",
    () =>
      Effect.gen(function* () {
        for (const path of ["/email-otp/send-verification-otp", "/sign-up/email", "/get-session"])
          assert.strictEqual(
            (yield* SiteAuthTest.serve(SiteAuthTest.authRequest(path, { email: ADMIN }))).status,
            404,
            path,
          );
      }).pipe(Effect.provide(layer())),
  );
});

describe("code delivery", () => {
  it.live("inline: the code comes back and nothing is mailed", () =>
    Effect.gen(function* () {
      assert.isTrue(Option.isSome(codeOf(yield* requestCode(ADMIN))));
      assert.deepStrictEqual(yield* Ref.get(yield* SentMail), []);
    }).pipe(Effect.provide(SiteAuthTest.layer({ users: SEEDED, delivery: "inline" }))),
  );

  it.live("mailed: no code comes back, the address is mailed one, and it signs in", () =>
    Effect.gen(function* () {
      assert.isTrue(Option.isNone(codeOf(yield* requestCode(ADMIN))));
      const mails = yield* Ref.get(yield* SentMail);
      assert.lengthOf(mails, 1);
      assert.strictEqual(mails[0]?.to, ADMIN);
      const code = /\b(?<code>[0-9]{6})\b/u.exec(mails[0]?.text ?? "")?.groups?.code ?? "";
      assert.isTrue((yield* SiteAuthTest.verify(ADMIN, code)).ok);
    }).pipe(Effect.provide(SiteAuthTest.layer({ users: SEEDED, delivery: "mailed" }))),
  );

  it.live("mailed: an address that may not sign in is mailed nothing", () =>
    Effect.gen(function* () {
      yield* requestCode(STRANGER);
      assert.deepStrictEqual(yield* Ref.get(yield* SentMail), []);
    }).pipe(Effect.provide(SiteAuthTest.layer({ users: SEEDED, delivery: "mailed" }))),
  );
});

describe("the control door's IssueSignInCode", () => {
  const issue = (address: Email) =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SiteAuthControlRpcs);
      return yield* client.IssueSignInCode({ email: address });
    }).pipe(Effect.provide(siteAuthControlHandlers), Effect.scoped);

  it.live(
    "under mailed delivery answers a code in the same call, mails nothing, and the code signs in",
    () =>
      Effect.gen(function* () {
        const { code } = yield* issue(ADMIN);
        assert.deepStrictEqual(yield* Ref.get(yield* SentMail), []);
        assert.isTrue((yield* SiteAuthTest.verify(ADMIN, code)).ok);
      }).pipe(Effect.provide(SiteAuthTest.layer({ users: SEEDED, delivery: "mailed" }))),
  );

  it.live("dies for an address that may not sign in", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(issue(STRANGER));
      assert.isTrue(Exit.hasDies(exit));
    }).pipe(Effect.provide(SiteAuthTest.layer({ users: SEEDED, delivery: "mailed" }))),
  );
});

/** A Rate Limit binding that admits `limit` calls per key. */
const countingLimit = (limit: number) =>
  Effect.sync(() => {
    const counts = new Map<string, number>();
    const client: Cloudflare.RateLimitClient = {
      raw: Effect.die("no raw binding in a test"),
      limit: ({ key }) =>
        Effect.sync(() => {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return { success: count <= limit };
        }),
    };
    return client;
  });

describe("the sign-in limiter", () => {
  const layer = () =>
    SiteAuthTest.layer({
      users: SEEDED,
      limiter: SignInLimiter.layer({ asEffect: () => countingLimit(2) }),
    });

  it.live("limits one address across clients", () =>
    Effect.gen(function* () {
      yield* requestCode(ADMIN, "198.51.100.1");
      yield* requestCode(ADMIN, "198.51.100.2");
      const failure = yield* crossed(requestCode(ADMIN, "198.51.100.3"));
      assert.strictEqual((failure as { readonly _tag: string })._tag, "TooManyRequestsError");
    }).pipe(Effect.provide(layer())),
  );

  it.live("limits one client across addresses", () =>
    Effect.gen(function* () {
      yield* requestCode(ADMIN, "198.51.100.1");
      yield* requestCode(USER, "198.51.100.1");
      const failure = yield* crossed(requestCode(STRANGER, "198.51.100.1"));
      assert.strictEqual((failure as { readonly _tag: string })._tag, "TooManyRequestsError");
    }).pipe(Effect.provide(layer())),
  );

  it.live("a refused request issues no code", () =>
    Effect.gen(function* () {
      const { sqlite } = yield* D1Test;
      const codes = () => sqlite.prepare("select id from verification").all().length;
      yield* requestCode(ADMIN);
      yield* requestCode(ADMIN);
      const before = codes();
      yield* Effect.exit(requestCode(ADMIN));
      assert.strictEqual(codes(), before);
    }).pipe(Effect.provide(layer())),
  );
});

describe("serveAdmin", () => {
  const methods = {
    ping: (payload: { readonly id: string }) => Effect.succeed(`pong ${payload.id}`),
    refuse: () => Effect.fail(new OrphanInstalledError()),
  };
  const failures = { ping: Schema.Never, refuse: OrphanInstalledError };
  const layer = () => SiteAuthTest.layer({ users: SEEDED });

  it.live("serves an admin's request", () =>
    Effect.gen(function* () {
      const served = yield* serveAdmin(methods, failures);
      const cookie = yield* SiteAuthTest.signIn(ADMIN);
      assert.strictEqual(yield* served.ping({ cookie, ip: undefined }, { id: "1" }), "pong 1");
    }).pipe(Effect.provide(layer())),
  );

  it.live("refuses a signed-out request with UnauthorizedError, before the method runs", () =>
    Effect.gen(function* () {
      const served = yield* serveAdmin(methods, failures);
      assert.deepStrictEqual(yield* crossed(served.refuse(NO_REQUEST)), {
        _tag: "UnauthorizedError",
      });
    }).pipe(Effect.provide(layer())),
  );

  it.live("refuses a user who is not an admin with ForbiddenError", () =>
    Effect.gen(function* () {
      const served = yield* serveAdmin(methods, failures);
      const cookie = yield* SiteAuthTest.signIn(USER);
      assert.deepStrictEqual(yield* crossed(served.ping({ cookie, ip: undefined }, { id: "1" })), {
        _tag: "ForbiddenError",
      });
    }).pipe(Effect.provide(layer())),
  );

  it.live("keeps each method's own declared failure beside the gate's", () =>
    Effect.gen(function* () {
      const served = yield* serveAdmin(methods, failures);
      const cookie = yield* SiteAuthTest.signIn(ADMIN);
      assert.deepStrictEqual(yield* crossed(served.refuse({ cookie, ip: undefined })), {
        _tag: "OrphanInstalledError",
      });
    }).pipe(Effect.provide(layer())),
  );
});
