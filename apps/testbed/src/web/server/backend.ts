import { toRpcAsync } from "@alchemy.run/cloudflare/Bridge";

import type Backend from "#backend/worker.ts";

import { env } from "./env.server.ts";

export const backend = () => toRpcAsync<Backend>(env.BACKEND);
