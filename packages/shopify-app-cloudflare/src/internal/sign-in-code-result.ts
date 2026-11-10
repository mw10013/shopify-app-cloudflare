import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { rescue } from "./rescue.ts";
import {
  type RequestInfo,
  SignInCodeRequested,
  TooManyRequestsError,
} from "./site-auth-contract.ts";

/** The fields of the browser's request a Backend method may read: its cookie and client IP. */
export const requestInfoOf = (request: Request): RequestInfo => ({
  cookie: request.headers.get("cookie") ?? undefined,
  ip: request.headers.get("cf-connecting-ip") ?? undefined,
});

/**
 * What the sign-in page renders after a code request: `Sent`, with the code only under inline
 * delivery, the same whether or not the address may sign in; or `TooManyRequestsError`.
 */
export type SignInCodeResult =
  | { readonly _tag: "Sent"; readonly code: string | undefined }
  | { readonly _tag: "TooManyRequestsError" };

const decodeRequested = Schema.decodeUnknownSync(SignInCodeRequested);

/**
 * `requestSignInCode`'s answer over the binding as a {@link SignInCodeResult}. Any other failure
 * rejects unchanged.
 *
 * @example
 * ```ts
 * .handler(({ data }) =>
 *   signInCodeResult(backend().requestSignInCode(requestInfoOf(getRequest()), data)),
 * );
 * ```
 */
export const signInCodeResult = (answer: Promise<unknown>): Promise<SignInCodeResult> =>
  answer
    .then((value): SignInCodeResult => ({
      _tag: "Sent",
      code: Option.getOrUndefined(decodeRequested(value).code),
    }))
    .catch(
      rescue(TooManyRequestsError, (): SignInCodeResult => ({ _tag: "TooManyRequestsError" })),
    );
