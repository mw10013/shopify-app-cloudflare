import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { TEST_ADMIN, TEST_USER } from "#root/stacks/site-auth.ts";

import { call } from "./call.ts";
import { fileStage } from "./file-stage.ts";
import { cookieOf, signIn, verify } from "./site-session.ts";
import Stack from "./stack.ts";

/**
 * Site sign-in through the real Backend in workerd, over D1 migrated from `migrations/` and
 * seeded by the stack: a code requested over `BACKEND`, checked through the Website's
 * `/api/auth/*` forward, and the admin gate on the orphan sweep's methods.
 */
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: fileStage("siteauth"),
});

const stack = beforeAll(deploy(Stack));
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack));

const signedOut = { cookie: undefined, ip: undefined };

/** The actor id of a shop with no installation, which `destroyOrphan` destroys. */
const orphanId = (websiteUrl: string) =>
  Effect.map(call(websiteUrl, "shopActorId", { shop: "orphan-shop.myshopify.com" }), (outcome) => {
    assert.strictEqual(outcome._tag, "Returned");
    return String((outcome as { readonly value: unknown }).value);
  });

test(
  "inline sign-in end to end: a code over BACKEND, checked through the Website, signs the admin in",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    const requested = yield* call(websiteUrl, "requestSignInCode", signedOut, {
      email: TEST_ADMIN,
    });
    assert.strictEqual(requested._tag, "Returned");
    const { code } = (requested as { readonly value: { readonly code: string | null } }).value;
    assert.isString(code);
    const response = yield* verify(websiteUrl, TEST_ADMIN, code ?? "");
    assert.strictEqual(response.status, 200);
    const me = yield* call(websiteUrl, "signedInUser", {
      cookie: cookieOf(response),
      ip: undefined,
    });
    assert.deepInclude(me, { _tag: "Returned" });
    assert.deepInclude((me as { readonly value: object }).value, {
      email: TEST_ADMIN,
      role: "admin",
    });
  }),
);

test(
  "an address the stage did not seed gets the same answer, without a code",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    assert.deepStrictEqual(
      yield* call(websiteUrl, "requestSignInCode", signedOut, { email: "nobody@testbed.test" }),
      { _tag: "Returned", value: { code: null } },
    );
  }),
);

test(
  "the admin gate: an admin gets in, a user is ForbiddenError, and signed out is UnauthorizedError",
  Effect.gen(function* () {
    const urls = yield* stack;
    const ORPHAN = yield* orphanId(urls.websiteUrl);
    const asAdmin = yield* signIn(urls, TEST_ADMIN);
    assert.deepStrictEqual(
      yield* call(
        urls.websiteUrl,
        "destroyOrphan",
        { cookie: asAdmin, ip: undefined },
        { id: ORPHAN },
      ),
      { _tag: "Returned" },
    );
    const asUser = yield* signIn(urls, TEST_USER);
    assert.deepStrictEqual(
      yield* call(
        urls.websiteUrl,
        "destroyOrphan",
        { cookie: asUser, ip: undefined },
        { id: ORPHAN },
      ),
      { _tag: "Threw", value: { _tag: "ForbiddenError" } },
    );
    assert.deepStrictEqual(
      yield* call(urls.websiteUrl, "destroyOrphan", signedOut, { id: ORPHAN }),
      { _tag: "Threw", value: { _tag: "UnauthorizedError" } },
    );
  }),
);

test(
  "the Website forwards no Better Auth endpoint but the code check and sign-out",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    const response = yield* Effect.promise(() =>
      fetch(new URL("api/auth/email-otp/send-verification-otp", websiteUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: TEST_ADMIN, type: "sign-in" }),
      }),
    );
    assert.strictEqual(response.status, 404);
  }),
);

test(
  "the sign-in limit trips for one address after five requests a minute",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    const address = `limited-${String(Date.now())}@testbed.test`;
    const answers = [];
    for (const _ of [1, 2, 3, 4, 5, 6])
      answers.push(
        (yield* call(websiteUrl, "requestSignInCode", signedOut, { email: address }))._tag,
      );
    assert.deepStrictEqual(answers, [
      "Returned",
      "Returned",
      "Returned",
      "Returned",
      "Returned",
      "Threw",
    ]);
    assert.deepStrictEqual(
      yield* call(websiteUrl, "requestSignInCode", signedOut, { email: address }),
      { _tag: "Threw", value: { _tag: "TooManyRequestsError" } },
    );
  }),
);
