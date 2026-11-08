import { assert, describe, it } from "@effect/vitest";

import Backend from "#backend/worker.ts";
import { backendWorkerFor } from "#e2e/backend-worker.ts";
import E2eBackend from "#e2e/worker.ts";

describe("backendWorkerFor", () => {
  it("only e2e deploys E2eBackend, the one Worker with the status route", () => {
    assert.strictEqual(backendWorkerFor("e2e"), E2eBackend);
    for (const environment of ["dev", "test", "staging", "production"] as const)
      assert.strictEqual(backendWorkerFor(environment), Backend, environment);
  });
});
