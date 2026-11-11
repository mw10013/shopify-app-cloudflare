import { SignOutButton } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  return (
    <s-page heading="Admin" inlineSize="small">
      <SignOutButton
        slot="secondary-actions"
        onSignedOut={() => {
          void router.navigate({ to: "/admin/sign-in" });
        }}
      />
      <s-section>
        <s-stack gap="base">
          <s-paragraph data-testid="signed-in-as">{user.email}</s-paragraph>
          <Link to="/admin/shops">Shops</Link>
          <Link to="/admin/shop-actor-objects">Shop Actor Objects</Link>
          <Link to="/admin/orphan-shop-actor-objects">Orphan Shop Actor Objects</Link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
