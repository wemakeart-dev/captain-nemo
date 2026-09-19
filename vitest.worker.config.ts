import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@proto": path.resolve(__dirname, "src/generated/ts"),
    },
  },
  test: {
    name: "worker",
    environment: "node",
    include: ["src/worker/**/*.test.ts"],
  },
});
