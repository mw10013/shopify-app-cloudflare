import { awaitHydration, expect, test } from "@mw10013/shopify-app-cloudflare/test/e2e";

import { TEST_ADMIN } from "#root/stacks/site-auth.ts";

test("an admin signs in with the code the page shows, and out again", async ({ page, app }) => {
  const site = `http://localhost:${String(app.server.port)}`;
  await page.goto(`${site}/admin`);
  await page.waitForURL(/\/admin\/sign-in\?/u);
  await awaitHydration(page);

  await page.getByLabel("Email").fill(TEST_ADMIN);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = page.getByTestId("sign-in-code");
  await expect(code).toHaveText(/^[0-9]{8}$/u);
  await page.getByLabel("Code").fill((await code.textContent()) ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(`${site}/admin`);
  await expect(page.getByTestId("signed-in-as")).toHaveText(TEST_ADMIN);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/admin\/sign-in$/u);
  await page.goto(`${site}/admin`);
  await page.waitForURL(/\/admin\/sign-in\?/u);
});
