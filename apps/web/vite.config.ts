import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@homebase/protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Allow Cloudflare quick tunnels (dev-only testing on a phone); everything
    // else keeps Vite's default host checking.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": {
        target: process.env.HOMEBASE_DEV_HOST ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
