import { createFileRoute, redirect } from "@tanstack/react-router";

import { getSignedInUser } from "#web/server/site.ts";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    const user = await getSignedInUser();
    if (user === null)
      throw redirect({ to: "/admin/sign-in", search: { redirect: location.href } });
    return { user };
  },
});
