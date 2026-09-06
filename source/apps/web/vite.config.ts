import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

import { manifest, workbox } from "./src/pwa/config.ts";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      disable: mode === "android",
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["apple-touch-icon.png", "favicon-32x32.png"],
      manifest,
      workbox,
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
}));
