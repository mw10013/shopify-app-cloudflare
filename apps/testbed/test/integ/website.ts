import { authHandlers, webhookHandlers } from "@mw10013/shopify-app-cloudflare/website";

import { backend } from "#web/server/backend.ts";
import { env } from "#web/server/env.server.ts";

const webhooks = webhookHandlers(env);
const auth = authHandlers(env);

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/webhooks/"))
      return request.method === "POST" ? webhooks.POST({ request }) : webhooks.ANY();
    if (pathname.startsWith("/api/auth/"))
      return request.method === "POST" ? auth.POST({ request }) : auth.GET({ request });
    const method = pathname.slice(1);
    const args = await request.json<unknown[]>();
    const methods = backend() as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    return Response.json(
      await methods[method]?.(...args).then(
        (value) => ({ _tag: "Returned", value }),
        (thrown: unknown) =>
          thrown instanceof Error
            ? { _tag: "ThrewError", message: thrown.message }
            : { _tag: "Threw", value: thrown },
      ),
    );
  },
} satisfies ExportedHandler;
