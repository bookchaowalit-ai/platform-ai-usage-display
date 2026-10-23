import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      // The gate measures the server code; scripts/*.mjs are host-side helper CLIs.
      include: ["src/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
