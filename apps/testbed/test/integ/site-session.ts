import * as Test from "@alchemy.run/test/Vitest";
import { assert } from "@effect/vitest";
import { Email, SiteAuthControlRpcs } from "@mw10013/shopify-app-cloudflare/contract";
import * as Effect from "effect/Effect";
import * as RpcClient from "effect/rpc/RpcClient";
import * as Schema from "effect/Schema";

import { CONTROL_PATH } from "#backend/control.ts";

const email = Schema.decodeUnknownSync(Email);

export const verify = (websiteUrl: string, address: string, code: string) =>
  Effect.promise(() =>
    fetch(new URL("api/auth/sign-in/email-otp", websiteUrl), {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(websiteUrl).origin },
      body: JSON.stringify({ email: address, otp: code }),
    }),
  );

export const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

export const signIn = (
  urls: { readonly backendUrl: string; readonly websiteUrl: string },
  address: string,
) =>
  Effect.gen(function* () {
    const { code } = yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(SiteAuthControlRpcs);
      return yield* client.IssueSignInCode({ email: email(address) });
    }).pipe(
      Effect.scoped,
      Effect.provide(Test.rpcClientLayer(new URL(CONTROL_PATH, urls.backendUrl).href)),
    );
    const response = yield* verify(urls.websiteUrl, address, code);
    assert.strictEqual(response.status, 200);
    return cookieOf(response);
  });
