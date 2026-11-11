import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import { readEnv, setEnv } from "#dev/app-token-key/env-file.ts";
import { kidFor } from "#dev/app-token-key/key.ts";
import { type Registration, verify } from "#dev/app-token-key/verify.ts";
import { importAppTokenKey } from "#internal/app-token-assertion.ts";
import { ShopDomain } from "#internal/domain.ts";

const BIN = path.resolve(import.meta.dirname, "../../../src/dev/app-token-key/bin.ts");
const CLIENT_ID = "145364007aa2fa71bb14f6e4aad2bfd5";
const SHOP = ShopDomain.make("mw10013-pool-01.myshopify.com");
const NOV_10 = DateTime.makeUnsafe("2026-11-10T23:30:00Z");

let scratch: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "app-token-key-")));
  fs.writeFileSync(
    path.join(scratch, "shopify.app.toml"),
    `name = "My App"\nhandle = "my-app-dev"\nclient_id = "${CLIENT_ID}"\n\n[auth]\nredirect_urls = []\n`,
  );
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const appTokenKey = (...args: string[]) => {
  const run = spawnSync(process.execPath, [BIN, ...args], { cwd: scratch, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
};

const newKey = (dotenv: string) =>
  appTokenKey("new", "--config", "shopify.app.toml", "--dotenv", dotenv);

describe("kidFor", () => {
  it("is the handle and the UTC date", () => {
    assert.strictEqual(kidFor("my-app-dev", NOV_10, Option.none()), "my-app-dev-20261110");
    assert.strictEqual(
      kidFor("my-app-dev", NOV_10, Option.some("my-app-dev-20261009")),
      "my-app-dev-20261110",
    );
  });

  it("counts on from a kid that already took today's name", () => {
    assert.strictEqual(
      kidFor("my-app-dev", NOV_10, Option.some("my-app-dev-20261110")),
      "my-app-dev-20261110-2",
    );
    assert.strictEqual(
      kidFor("my-app-dev", NOV_10, Option.some("my-app-dev-20261110-2")),
      "my-app-dev-20261110-3",
    );
  });
});

describe("setEnv", () => {
  const values = { SHOPIFY_APP_TOKEN_KEY: "NEW", SHOPIFY_APP_TOKEN_KID: "kid-2" };

  it("replaces each assignment where it stands and keeps every other line", () => {
    const before = [
      "# Shopify",
      "SHOPIFY_API_SECRET=secret # inline",
      "",
      "SHOPIFY_APP_TOKEN_KID=kid-1",
      'export SHOPIFY_APP_TOKEN_KEY="-----BEGIN PRIVATE KEY-----',
      "MIGH",
      '-----END PRIVATE KEY-----"',
      "PARTNER_ORG=1",
      "",
    ].join("\n");
    assert.strictEqual(
      setEnv(before, values),
      [
        "# Shopify",
        "SHOPIFY_API_SECRET=secret # inline",
        "",
        "SHOPIFY_APP_TOKEN_KID=kid-2",
        "SHOPIFY_APP_TOKEN_KEY=NEW",
        "PARTNER_ORG=1",
        "",
      ].join("\n"),
    );
  });

  it("appends what the file lacks", () => {
    assert.strictEqual(
      setEnv("A=1", values),
      "A=1\nSHOPIFY_APP_TOKEN_KEY=NEW\nSHOPIFY_APP_TOKEN_KID=kid-2\n",
    );
    assert.strictEqual(
      setEnv("", values),
      "SHOPIFY_APP_TOKEN_KEY=NEW\nSHOPIFY_APP_TOKEN_KID=kid-2\n",
    );
  });
});

describe("readEnv", () => {
  it("reads bare, quoted and multi-line values, the last assignment winning", () => {
    const env = readEnv('A=1 # note\nB="two words"\nC=\'x\'\nD="line1\nline2"\nE=""\nA=again\n');
    assert.deepStrictEqual(Object.fromEntries(env), {
      A: "again",
      B: "two words",
      C: "x",
      D: "line1\nline2",
      E: "",
    });
  });
});

describe("app-token-key new", () => {
  it("creates the file 0600 and prints a JWK that verifies what the written key signs", async () => {
    const run = newKey(".env.staging");
    assert.strictEqual(run.status, 0, run.stderr);
    const file = path.join(scratch, ".env.staging");
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    const env = readEnv(fs.readFileSync(file, "utf8"));
    const key = env.get("SHOPIFY_APP_TOKEN_KEY") ?? "";
    assert.match(key, /^[A-Za-z0-9+/]+=*$/u);
    assert.notInclude(run.stdout + run.stderr, key);
    assert.include(run.stderr, "vp run stage up staging");
    assert.notInclude(run.stderr, "Rotation");

    const jwk = JSON.parse(run.stdout) as Record<string, string>;
    const kid = env.get("SHOPIFY_APP_TOKEN_KID");
    assert.match(kid ?? "", /^my-app-dev-\d{8}$/u);
    assert.deepStrictEqual(Object.keys(jwk).toSorted(), [
      "alg",
      "crv",
      "kid",
      "kty",
      "use",
      "x",
      "y",
    ]);
    assert.include(jwk, { kty: "EC", crv: "P-256", kid, alg: "ES256", use: "sig" });

    const message = new TextEncoder().encode("signed");
    const privateKey = await Effect.runPromise(importAppTokenKey(Redacted.make(key)));
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      message,
    );
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    assert.isTrue(
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, message),
    );
  });

  it("rotates in place: a new key and a suffixed kid, other lines kept, the file's mode kept", () => {
    const file = path.join(scratch, ".env");
    fs.writeFileSync(file, "# local\nSHOPIFY_API_SECRET=s\n", { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    assert.strictEqual(newKey(".env").status, 0);
    const first = readEnv(fs.readFileSync(file, "utf8"));
    const firstKid = first.get("SHOPIFY_APP_TOKEN_KID") ?? "";
    const run = newKey(".env");
    assert.strictEqual(run.status, 0, run.stderr);
    const text = fs.readFileSync(file, "utf8");
    const second = readEnv(text);
    assert.isTrue(text.startsWith("# local\nSHOPIFY_API_SECRET=s\n"));
    assert.strictEqual(second.get("SHOPIFY_APP_TOKEN_KID"), `${firstKid}-2`);
    assert.notStrictEqual(second.get("SHOPIFY_APP_TOKEN_KEY"), first.get("SHOPIFY_APP_TOKEN_KEY"));
    assert.include(run.stderr, `Then revoke ${firstKid}`);
    assert.notInclude(run.stderr, "vp run stage up");
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o644);
  });
});

describe("app-token-key verify", () => {
  it("names the missing variable", () => {
    fs.writeFileSync(path.join(scratch, ".env"), "A=1\n");
    const run = appTokenKey(
      "verify",
      "--config",
      "shopify.app.toml",
      "--dotenv",
      ".env",
      "--shop",
      SHOP,
    );
    assert.strictEqual(run.status, 1);
    assert.include(run.stderr, ".env has no SHOPIFY_APP_TOKEN_KID");
  });
});

interface Seen {
  readonly url: string;
  readonly body: URLSearchParams;
}

const over = (reply: Response) => {
  const seen: Seen[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      seen.push({
        url: request.url,
        body: new URLSearchParams(
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        ),
      });
      return HttpClientResponse.fromWeb(request, reply);
    }),
  );
  return { seen, provide: Effect.provideService(HttpClient.HttpClient, client) };
};

const signer = Effect.gen(function* () {
  const pair = yield* Effect.promise(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
  );
  return { clientId: CLIENT_ID, kid: "my-app-dev-20261110", key: pair.privateKey };
});

describe("verify", () => {
  const answers: readonly (readonly [string, Response, Registration])[] = [
    [
      "a token",
      Response.json({ access_token: "shpat_x", expires_in: 3599, scope: "" }),
      { _tag: "Installed" },
    ],
    [
      "app_not_installed",
      Response.json({ error: "app_not_installed" }, { status: 400 }),
      { _tag: "NotInstalled" },
    ],
    [
      "invalid_client",
      Response.json({ error: "invalid_client" }, { status: 401 }),
      { _tag: "NotRegistered" },
    ],
    [
      "anything else",
      Response.json({ error: "invalid_request" }, { status: 400 }),
      { _tag: "Refused", status: 400, error: "invalid_request" },
    ],
    [
      "a body that is not JSON",
      new Response("<html>", { status: 503 }),
      { _tag: "Refused", status: 503, error: "none" },
    ],
  ];

  for (const [label, reply, expected] of answers)
    it.effect(`classifies ${label}`, () =>
      Effect.gen(function* () {
        const { seen, provide } = over(reply);
        const registration = yield* verify(yield* signer, SHOP).pipe(provide);
        assert.deepStrictEqual(registration, expected);
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0]?.url, `https://${SHOP}/admin/oauth/access_token`);
      }),
    );

  it.effect("posts one client_credentials grant with an assertion for the shop", () =>
    Effect.gen(function* () {
      const { seen, provide } = over(Response.json({ error: "invalid_client" }, { status: 401 }));
      yield* verify(yield* signer, SHOP).pipe(provide);
      const body = seen[0]?.body;
      assert.strictEqual(body?.get("grant_type"), "client_credentials");
      assert.strictEqual(body?.get("client_id"), CLIENT_ID);
      const [header = "", payload = ""] = (body?.get("client_assertion") ?? "").split(".");
      const decode = (part: string) => {
        const decoded = Base64Url.decodeString(part);
        return Result.isSuccess(decoded) ? (JSON.parse(decoded.success) as unknown) : undefined;
      };
      assert.deepInclude(decode(header), { alg: "ES256", kid: "my-app-dev-20261110" });
      assert.deepInclude(decode(payload), {
        iss: CLIENT_ID,
        sub: CLIENT_ID,
        aud: `https://${SHOP}/admin/oauth/access_token`,
      });
    }),
  );
});
