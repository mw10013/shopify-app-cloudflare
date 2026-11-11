import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { type Browser, chromium } from "playwright";

import { routeAppToLocal } from "#dev/local-route.ts";

/** A hostname that never resolves, as a quick tunnel's does in its first minute. */
const tunnel = "https://unresolvable-tunnel.invalid";

describe("routeAppToLocal", () => {
  let server: Server;
  let port: number;
  let browser: Browser;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", tunnel);
      if (url.pathname === "/") {
        response.writeHead(307, {
          location: `/app${url.search}`,
          "set-cookie": "hop=1; Path=/; Secure",
        });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        `<p id="host">${request.headers.host ?? ""}</p><p id="cookie">${request.headers.cookie ?? ""}</p>`,
      );
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "localhost", resolve);
    });
    port = (server.address() as AddressInfo).port;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it("follows the app's redirects from the local port, in the page and in a frame", async () => {
    const context = await browser.newContext();
    await routeAppToLocal(context, { port, tunnel });
    await context.route("https://admin.invalid/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<iframe src="${tunnel}/?embedded=1"></iframe>`,
      }),
    );
    const page = await context.newPage();

    await page.goto(`${tunnel}/?embedded=1`);
    await page.locator("#host").waitFor();
    assert.strictEqual(page.url(), `${tunnel}/app?embedded=1`);
    assert.strictEqual(await page.locator("#host").textContent(), "unresolvable-tunnel.invalid");
    assert.strictEqual(await page.locator("#cookie").textContent(), "hop=1");

    await page.goto("https://admin.invalid/");
    const frame = page.frameLocator("iframe");
    await frame.locator("#host").waitFor({ timeout: 5000 });
    assert.strictEqual(await frame.locator("#host").textContent(), "unresolvable-tunnel.invalid");
    await context.close();
  });
});
