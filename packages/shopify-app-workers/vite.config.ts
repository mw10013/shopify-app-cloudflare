import { app } from "@mw10013/rigging/core/app";
import { testRun } from "@mw10013/rigging/core/test";
import { defineConfig } from "vite-plus";

const { root } = app(import.meta.dirname);

export default defineConfig({
  test: { ...testRun(root), include: ["test/**/*.test.ts"] },
});
