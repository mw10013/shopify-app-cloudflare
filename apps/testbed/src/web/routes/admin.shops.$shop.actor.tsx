import { Field, Fields } from "@mw10013/shopify-app-cloudflare/website/react";
import { createFileRoute } from "@tanstack/react-router";

/** The testbed's own tab on the shop page, which proves an app adds one with a route alone. */
export const Route = createFileRoute("/admin/shops/$shop/actor")({
  staticData: { adminTab: { label: "Actor", order: 10 } },
  component: ActorRoute,
});

function ActorRoute() {
  const { shop } = Route.useParams();
  return (
    <s-section heading="Actor">
      <Fields>
        <Field label="Durable Object name">{shop}</Field>
      </Fields>
    </s-section>
  );
}
