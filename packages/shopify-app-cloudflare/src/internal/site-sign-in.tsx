import * as Duration from "effect/Duration";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { type ReactNode, useRef, useState } from "react";

import type { SignInCodeResult } from "./sign-in-code-result.ts";
import { AUTH_BASE_PATH, Email, SIGN_IN_CODE_TTL } from "./site-auth-contract.ts";

export type VerifyCodeResult =
  | { readonly _tag: "SignedIn" }
  | { readonly _tag: "InvalidCode" }
  | { readonly _tag: "CodeExpired" }
  | { readonly _tag: "TooManyAttempts" };

const ErrorBody = Schema.Struct({ code: Schema.optional(Schema.String) });
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

/**
 * Checks `code` for `email` against Better Auth's `/sign-in/email-otp`, forwarded by the app's
 * `/api/auth/$` route; a right one sets the session cookie. Any answer but Better Auth's refusal
 * of the code rejects.
 */
export const verifySignInCode = async (input: {
  readonly email: Email;
  readonly code: string;
}): Promise<VerifyCodeResult> => {
  const response = await fetch(`${AUTH_BASE_PATH}/sign-in/email-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, otp: input.code }),
  });
  if (response.ok) return { _tag: "SignedIn" };
  if (response.status !== 400 && response.status !== 403)
    throw new Error(`Sign-in answered ${String(response.status)}`);
  const code = Option.flatMap(decodeErrorBody(await response.json()), (body) =>
    Option.fromUndefinedOr(body.code),
  );
  return Match.value(Option.getOrUndefined(code)).pipe(
    Match.when("OTP_EXPIRED", (): VerifyCodeResult => ({ _tag: "CodeExpired" })),
    Match.when("TOO_MANY_ATTEMPTS", (): VerifyCodeResult => ({ _tag: "TooManyAttempts" })),
    Match.orElse((): VerifyCodeResult => ({ _tag: "InvalidCode" })),
  );
};

/** Ends the session: Better Auth's `/sign-out`, which clears the cookie. */
export const signOut = async (): Promise<void> => {
  const response = await fetch(`${AUTH_BASE_PATH}/sign-out`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Sign-out answered ${String(response.status)}`);
};

const decodeEmail = Schema.decodeUnknownOption(Email);

const SOMETHING_WENT_WRONG = "Something went wrong. Try again.";
const TOO_MANY_REQUESTS = "Too many attempts. Try again later.";
const ENTER_EMAIL = "Enter an email address";

type Step =
  | { readonly _tag: "Email"; readonly failure: string | undefined }
  | {
      readonly _tag: "Code";
      readonly email: Email;
      readonly shown: string | undefined;
      readonly failure: string | undefined;
    };

export interface SignInPageProps {
  readonly heading?: string;
  /** The app's server function: `requestSignInCode` over the binding, as {@link SignInCodeResult}. */
  readonly requestCode: (input: { readonly email: Email }) => Promise<SignInCodeResult>;
  /** Checks a code; {@link verifySignInCode} unless a test replaces it. */
  readonly verifyCode?: (input: {
    readonly email: Email;
    readonly code: string;
  }) => Promise<VerifyCodeResult>;
  /** Where to go once the session cookie is set: the app's route, read again. */
  readonly onSignedIn: () => void;
  /** Below the form on both steps. */
  readonly footer?: ReactNode;
}

/**
 * Sign-in by email code, in two steps: the address, then the code. The second step looks the same
 * whether or not the address may sign in, so the page never says who may. Under inline delivery
 * the answer carries the code, which the page shows above the field.
 */
export function SignInPage(props: SignInPageProps) {
  const { requestCode, verifyCode = verifySignInCode, onSignedIn } = props;
  const [step, setStep] = useState<Step>({ _tag: "Email", failure: undefined });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [emailValue, setEmailValue] = useState("");
  const [codeValue, setCodeValue] = useState("");

  const once = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const sendCode = () =>
    once(async () => {
      const email = decodeEmail(emailValue);
      if (Option.isNone(email)) {
        setStep({ _tag: "Email", failure: ENTER_EMAIL });
        return;
      }
      const next = await requestCode({ email: email.value }).then(
        (result): Step =>
          Match.valueTags(result, {
            Sent: ({ code }): Step => ({
              _tag: "Code",
              email: email.value,
              shown: code,
              failure: undefined,
            }),
            TooManyRequestsError: (): Step => ({ _tag: "Email", failure: TOO_MANY_REQUESTS }),
          }),
        (): Step => ({ _tag: "Email", failure: SOMETHING_WENT_WRONG }),
      );
      setCodeValue("");
      setStep(next);
    });

  const checkCode = (current: Extract<Step, { _tag: "Code" }>) =>
    once(async () => {
      const result = await verifyCode({ email: current.email, code: codeValue.trim() }).catch(
        (): undefined => undefined,
      );
      if (result?._tag === "SignedIn") {
        onSignedIn();
        return;
      }
      const failure =
        result === undefined
          ? SOMETHING_WENT_WRONG
          : Match.value(result._tag).pipe(
              Match.when("InvalidCode", () => "That code isn't right. Check it and try again."),
              Match.when("CodeExpired", () => "That code has expired. Request a new one."),
              Match.when("TooManyAttempts", () => "Too many wrong codes. Request a new one."),
              Match.exhaustive,
            );
      setStep({ ...current, failure });
    });

  return (
    <s-page heading={props.heading ?? "Sign in"} inlineSize="small">
      {step._tag === "Email" ? (
        <s-section accessibilityLabel="Sign in">
          <s-stack gap="base">
            <s-paragraph color="subdued">We'll email you a sign-in code.</s-paragraph>
            {step.failure !== undefined && <s-banner tone="critical" heading={step.failure} />}
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void sendCode();
              }}
            >
              <s-stack gap="base">
                <s-email-field
                  label="Email"
                  name="email"
                  autocomplete="email"
                  value={emailValue}
                  onInput={(event) => {
                    setEmailValue(event.currentTarget.value);
                  }}
                />
                <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
                  Send code
                </s-button>
              </s-stack>
            </form>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Check your email">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              {`If ${step.email} may sign in, we sent it a code. It expires in ${String(Duration.toMinutes(SIGN_IN_CODE_TTL))} minutes.`}
            </s-paragraph>
            {step.shown !== undefined && (
              <s-banner tone="info" heading="Your code">
                <s-text data-testid="sign-in-code">{step.shown}</s-text>
              </s-banner>
            )}
            {step.failure !== undefined && <s-banner tone="critical" heading={step.failure} />}
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void checkCode(step);
              }}
            >
              <s-stack gap="base">
                <s-text-field
                  label="Code"
                  name="code"
                  autocomplete="one-time-code"
                  value={codeValue}
                  onInput={(event) => {
                    setCodeValue(event.currentTarget.value);
                  }}
                />
                <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
                  Sign in
                </s-button>
                <s-button
                  variant="tertiary"
                  onClick={() => {
                    setStep({ _tag: "Email", failure: undefined });
                  }}
                >
                  Use a different email
                </s-button>
              </s-stack>
            </form>
          </s-stack>
        </s-section>
      )}
      {props.footer}
    </s-page>
  );
}

/** A sign-out button for an `s-page`'s actions: it ends the session, then calls `onSignedOut`. */
export function SignOutButton(props: {
  readonly onSignedOut: () => void;
  readonly slot?: "secondary-actions";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <s-button
      variant="secondary"
      {...(props.slot === undefined ? {} : { slot: props.slot })}
      {...(busy ? { loading: true } : {})}
      onClick={() => {
        setBusy(true);
        void signOut().then(props.onSignedOut, () => {
          setBusy(false);
        });
      }}
    >
      Sign out
    </s-button>
  );
}
