import { app } from "@mw10013/rigging/core/app";
import { testRunDirectory } from "@mw10013/rigging/core/test-runs";
import { defineConfig } from "vite-plus";

const { root } = app(import.meta.dirname);

export default defineConfig(({ mode }) => ({
  test: {
    ...(mode === "test"
      ? {
          reporters: [
            "default",
            ["json", { outputFile: `${testRunDirectory("test", [], root)}/results.json` }],
          ],
        }
      : {}),
    include: ["test/**/*.test.ts"],
  },
}));
