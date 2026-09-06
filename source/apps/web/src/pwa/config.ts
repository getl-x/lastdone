import type { ManifestOptions, VitePWAOptions } from "vite-plugin-pwa";

export const manifest = {
  name: "LastDone · 记住上次，安排下次",
  short_name: "LastDone",
  description: "记住不定期重复事项的上次完成时间，并安排下次。",
  lang: "zh-CN",
  dir: "ltr",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  theme_color: "#5b5bd6",
  background_color: "#f6f7fc",
  categories: ["productivity", "utilities"],
  icons: [
    {
      src: "/pwa-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/maskable-icon-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  shortcuts: [
    {
      name: "新建事项",
      short_name: "新建",
      url: "/items/new",
      icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
    },
  ],
} satisfies Partial<ManifestOptions>;

export const workbox: VitePWAOptions["workbox"] = {
  globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/api\//, /^\/_\//],
  cleanupOutdatedCaches: true,
  clientsClaim: false,
  skipWaiting: false,
  importScripts: ["/push-handler.js"],
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "NetworkFirst",
      options: {
        cacheName: "lastdone-navigation",
        networkTimeoutSeconds: 3,
        expiration: {
          maxEntries: 20,
          maxAgeSeconds: 24 * 60 * 60,
        },
      },
    },
  ],
};
