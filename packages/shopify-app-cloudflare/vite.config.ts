import { app } from "@mw10013/rigging/core/app";
import { browserProject } from "@mw10013/rigging/core/browser-test";
import { testRun, unitProject } from "@mw10013/rigging/core/test";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const { root } = app(import.meta.dirname);

export default defineConfig({
  test: {
    ...testRun(root),
    projects: [
      unitProject({ include: ["test/**/*.test.ts"], exclude: ["test/browser/**"] }),
      {
        plugins: [react()],
        ...browserProject({ setupFiles: ["test/browser/setup.ts"] }),
      },
    ],
  },
});
