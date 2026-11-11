import { createFileRoute } from "@tanstack/react-router";

/** The testbed's own tab under the shop layout, which proves an app adds one with a route alone. */
export const Route = createFileRoute("/admin/shop/$shop/actor")({
  staticData: { adminTab: { label: "Actor", order: 10 } },
  component: ActorRoute,
});

function ActorRoute() {
  const { shop } = Route.useParams();
  return (
    <s-section heading="Actor">
      <s-paragraph>The shop's actor is the Durable Object named {shop}.</s-paragraph>
    </s-section>
  );
}
