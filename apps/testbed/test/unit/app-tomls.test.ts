import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import { workerNameOf } from "@mw10013/rigging/cloudflare/stage";
import { parse } from "smol-toml";

const WORKERS_SUBDOMAIN = "mw10013.workers.dev";

const read = (file: string) =>
  parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));

const dev = read("shopify.app.toml");
const staging = read("shopify.app.staging.toml");

const stagingUrl = `https://${workerNameOf("testbed", "staging", "website")}.${WORKERS_SUBDOMAIN}`;

describe("the testbed's app tomls", () => {
  it("staging declares the dev app's access scopes, webhooks and embedding", () => {
    expect(staging.access_scopes).toStrictEqual(dev.access_scopes);
    expect(staging.webhooks).toStrictEqual(dev.webhooks);
    expect(staging.embedded).toBe(dev.embedded);
  });

  it("staging's application_url is the staging Website Worker's URL", () => {
    expect(staging.application_url).toBe(stagingUrl);
  });

  it("staging's only redirect URL is its application_url's /api/auth", () => {
    expect(staging.auth).toEqual({ redirect_urls: [`${stagingUrl}/api/auth`] });
  });

  it("staging is the workers-testbed-staging app and dev never rewrites its URLs", () => {
    expect(staging.handle).toBe("workers-testbed-staging");
    expect(staging.build).toMatchObject({ automatically_update_urls_on_dev: false });
  });
});
