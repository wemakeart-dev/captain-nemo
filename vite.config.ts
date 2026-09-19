import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "src/web",
  publicDir: "public",
  resolve: {
    alias: {
      "@proto": path.resolve(__dirname, "src/generated/ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "src")],
    },
  },
  worker: {
    format: "es",
  },
});
