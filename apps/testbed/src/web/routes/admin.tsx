import { createFileRoute, redirect } from "@tanstack/react-router";

import { getSignedInUser } from "#web/server/site.ts";

/**
 * The admin side. Its only check is for a session, to send a signed-out visitor to sign-in: the
 * Backend's admin gate decides who is an admin, in every method these pages call.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    const user = await getSignedInUser();
    if (user === null)
      throw redirect({ to: "/admin/sign-in", search: { redirect: location.href } });
    return { user };
  },
});
