import { app } from "@mw10013/devkit/core/app";
import { testRunDirectory } from "@mw10013/devkit/core/test-runs";
import { defineConfig } from "vite-plus";

const { root } = app(import.meta.dirname);

export default defineConfig(({ mode }) => ({
  test: {
    // Every run's results stay in its own directory (`@mw10013/devkit/core/test-runs`), failures included.
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
