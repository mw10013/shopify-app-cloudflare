import { Field, Fields } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute } from "@tanstack/react-router";

/** The testbed's own admin page, which the admin home lists from its `staticData.admin`. */
export const Route = createFileRoute("/admin/account")({
  staticData: { admin: { title: "Account", summary: "Who is signed in.", order: 40 } },
  component: AccountRoute,
});

function AccountRoute() {
  const { user } = Route.useRouteContext();
  return (
    <s-section heading="Signed in">
      <Fields>
        <Field label="Email">
          <span data-testid="signed-in-as">{user.email}</span>
        </Field>
      </Fields>
    </s-section>
  );
}
