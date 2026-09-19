import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@proto": path.resolve(__dirname, "src/generated/ts"),
    },
  },
  test: {
    name: "web",
    environment: "happy-dom",
    include: ["src/web/**/*.test.ts"],
  },
});
