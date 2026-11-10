import { assert, describe, it } from "@effect/vitest";
import { TooManyRequestsError } from "@mw10013/shopify-app-cloudflare/contract";
import {
  authHandlers,
  requestInfoOf,
  signInCodeResult,
} from "@mw10013/shopify-app-cloudflare/website";
import { SignInPage } from "@mw10013/shopify-app-cloudflare/website/react";
import * as Function from "effect/Function";
import * as Schema from "effect/Schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("authHandlers", () => {
  const forwarded: Request[] = [];
  const handlers = authHandlers({
    BACKEND: {
      fetch: (request) => {
        forwarded.push(request);
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    },
  });
  const request = (method: string, path: string) =>
    new Request(`https://site.test${path}`, {
      method,
      ...(method === "POST" ? { body: "{}" } : {}),
    });

  it("forwards the code check and sign-out to the Backend, unfollowed", async () => {
    forwarded.length = 0;
    for (const path of ["/api/auth/sign-in/email-otp", "/api/auth/sign-out"])
      assert.strictEqual((await handlers.POST({ request: request("POST", path) })).status, 204);
    assert.deepStrictEqual(
      forwarded.map((sent) => [new URL(sent.url).pathname, sent.redirect]),
      [
        ["/api/auth/sign-in/email-otp", "manual"],
        ["/api/auth/sign-out", "manual"],
      ],
    );
  });

  it("answers 404 for every other Better Auth endpoint, and forwards nothing", async () => {
    forwarded.length = 0;
    for (const [method, path] of [
      ["POST", "/api/auth/email-otp/send-verification-otp"],
      ["POST", "/api/auth/sign-up/email"],
      ["GET", "/api/auth/get-session"],
      ["GET", "/api/auth/sign-out"],
    ] as const) {
      const handler = method === "GET" ? handlers.GET : handlers.POST;
      assert.strictEqual((await handler({ request: request(method, path) })).status, 404, path);
    }
    assert.deepStrictEqual(forwarded, []);
  });
});

describe("requestInfoOf", () => {
  it("reads only the cookie and the client IP Cloudflare stamps", () => {
    assert.deepStrictEqual(
      requestInfoOf(
        new Request("https://site.test/", {
          headers: { cookie: "a=1", "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "x" },
        }),
      ),
      { cookie: "a=1", ip: "198.51.100.1" },
    );
    assert.deepStrictEqual(requestInfoOf(new Request("https://site.test/")), {
      cookie: undefined,
      ip: undefined,
    });
  });
});

describe("signInCodeResult", () => {
  it("answers Sent with the code under inline delivery, and without one otherwise", async () => {
    assert.deepStrictEqual(await signInCodeResult(Promise.resolve({ code: "123456" })), {
      _tag: "Sent",
      code: "123456",
    });
    assert.deepStrictEqual(await signInCodeResult(Promise.resolve({ code: null })), {
      _tag: "Sent",
      code: undefined,
    });
  });

  it("answers the rate limit's refusal as data, and rethrows anything else", async () => {
    assert.deepStrictEqual(
      await signInCodeResult(
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the binding rejects with the plain encoded failure
        Promise.reject(Schema.encodeSync(TooManyRequestsError)(new TooManyRequestsError())),
      ),
      { _tag: "TooManyRequestsError" },
    );
    const defect = new Error("boom");
    const thrown = await signInCodeResult(Promise.reject(defect)).catch((error: unknown) => error);
    assert.strictEqual(thrown, defect);
  });
});

describe("SignInPage", () => {
  it("starts on the email step", () => {
    const html = renderToStaticMarkup(
      createElement(SignInPage, {
        heading: "Admin sign in",
        requestCode: () => Promise.resolve({ _tag: "Sent" as const, code: undefined }),
        onSignedIn: Function.constVoid,
      }),
    );
    assert.include(html, 'heading="Admin sign in"');
    assert.include(html, 'label="Email"');
    assert.include(html, "Send code");
    assert.notInclude(html, 'label="Code"');
  });
});
