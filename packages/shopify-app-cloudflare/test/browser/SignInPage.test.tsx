import type { Email } from "@mw10013/shopify-app-cloudflare/contract";
import type { SignInCodeResult } from "@mw10013/shopify-app-cloudflare/website";
import {
  SignInPage,
  type SignInPageProps,
  type VerifyCodeResult,
} from "@mw10013/shopify-app-cloudflare/website/react";
import * as Function from "effect/Function";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

const ADMIN = "admin@site.test";

const sent = (code?: string) => Promise.resolve<SignInCodeResult>({ _tag: "Sent", code });

const signInPage = (props: Partial<SignInPageProps> = {}) =>
  render(
    <SignInPage
      heading="Admin sign in"
      requestCode={() => sent()}
      verifyCode={() => Promise.resolve<VerifyCodeResult>({ _tag: "SignedIn" })}
      onSignedIn={Function.constVoid}
      {...props}
    />,
  );

type Screen = Awaited<ReturnType<typeof signInPage>>;

const sendCodeTo = async (screen: Screen, email: string) => {
  await userEvent.fill(screen.getByRole("textbox", { name: "Email" }), email);
  await screen.getByRole("button", { name: "Send code" }).click();
};

describe("SignInPage", () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("asks for the address, shows an inline code, and signs in with the code typed", async () => {
    const requested: Email[] = [];
    const checked: { readonly email: Email; readonly code: string }[] = [];
    let signedIn = 0;
    const screen = await signInPage({
      requestCode: ({ email }) => {
        requested.push(email);
        return sent("123456");
      },
      verifyCode: (input) => {
        checked.push(input);
        return Promise.resolve({ _tag: "SignedIn" });
      },
      onSignedIn: () => {
        signedIn++;
      },
    });
    await expect.element(screen.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    await sendCodeTo(screen, " Admin@Site.test ");
    await expect.element(screen.getByText("Check your email")).toBeVisible();
    await expect.element(screen.getByTestId("sign-in-code")).toHaveTextContent("123456");
    await userEvent.fill(screen.getByRole("textbox", { name: "Code" }), "123456");
    await screen.getByRole("button", { name: "Sign in" }).click();
    await expect.poll(() => signedIn).toBe(1);
    expect(requested).toStrictEqual([ADMIN]);
    expect(checked).toStrictEqual([{ email: ADMIN, code: "123456" }]);
  });

  it("under mailed delivery shows no code, and says the same whoever asked", async () => {
    const screen = await signInPage();
    await sendCodeTo(screen, ADMIN);
    await expect
      .element(
        screen.getByText(`If ${ADMIN} may sign in, we sent it a code. It expires in 5 minutes.`),
      )
      .toBeVisible();
    expect(screen.getByTestId("sign-in-code").query()).toBeNull();
  });

  it("refuses an address that is not one, and asks for none", async () => {
    let requests = 0;
    const screen = await signInPage({
      requestCode: () => {
        requests++;
        return sent();
      },
    });
    await sendCodeTo(screen, "not-an-address");
    await expect.element(screen.getByText("Enter an email address")).toBeVisible();
    expect(requests).toBe(0);
  });

  it("the rate limit's refusal stays on the email step", async () => {
    const screen = await signInPage({
      requestCode: () => Promise.resolve({ _tag: "TooManyRequestsError" }),
    });
    await sendCodeTo(screen, ADMIN);
    await expect.element(screen.getByText("Too many attempts. Try again later.")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Send code" })).toBeVisible();
  });

  it("a wrong, an expired and a spent code each say so, and a different email starts over", async () => {
    const answers: VerifyCodeResult[] = [
      { _tag: "InvalidCode" },
      { _tag: "CodeExpired" },
      { _tag: "TooManyAttempts" },
    ];
    const screen = await signInPage({
      verifyCode: () => Promise.resolve(answers.shift() ?? { _tag: "InvalidCode" }),
    });
    await sendCodeTo(screen, ADMIN);
    await userEvent.fill(screen.getByRole("textbox", { name: "Code" }), "000000");
    for (const failure of [
      "That code isn't right. Check it and try again.",
      "That code has expired. Request a new one.",
      "Too many wrong codes. Request a new one.",
    ]) {
      await screen.getByRole("button", { name: "Sign in" }).click();
      await expect.element(screen.getByText(failure)).toBeVisible();
    }
    await screen.getByRole("button", { name: "Use a different email" }).click();
    await expect.element(screen.getByRole("button", { name: "Send code" })).toBeVisible();
  });

  it("shows the app's footer on both steps", async () => {
    const screen = await signInPage({
      footer: <s-link href="/help/signing-in">Learn more in Signing in</s-link>,
    });
    const help = screen.getByRole("link", { name: "Learn more in Signing in" });
    await expect.element(help).toHaveAttribute("href", "/help/signing-in");
    await sendCodeTo(screen, ADMIN);
    await expect.element(screen.getByText("Check your email")).toBeVisible();
    await expect.element(help).toBeVisible();
  });
});
