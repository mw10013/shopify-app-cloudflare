import { SignInPage } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { getSignedInUser, requestSignInCode } from "#web/server/site.ts";

const AdminPath = Schema.String.check(Schema.isPattern(/^\/admin(?:[/?#]\S*)?$/u));
const decodeAdminPath = Schema.decodeUnknownOption(AdminPath);

/** Outside `/admin`'s layout, so its session check does not send the sign-in page to itself. */
export const Route = createFileRoute("/admin_/sign-in")({
  validateSearch: (search: Record<string, unknown>): { readonly redirect?: string } =>
    Option.match(decodeAdminPath(search.redirect), {
      onNone: () => ({}),
      onSome: (path) => ({ redirect: path }),
    }),
  beforeLoad: async () => {
    if ((await getSignedInUser()) !== null) throw redirect({ to: "/admin" });
  },
  component: AdminSignIn,
});

function AdminSignIn() {
  const { redirect: returnTo } = Route.useSearch();
  const router = useRouter();
  const request = useServerFn(requestSignInCode);
  return (
    <SignInPage
      heading="Admin sign in"
      requestCode={async (input) => {
        const result = await request({ data: input });
        if (result === undefined) throw new Error("The sign-in request was redirected");
        return result;
      }}
      onSignedIn={() => {
        void router.navigate({ href: returnTo ?? "/admin" });
      }}
    />
  );
}
