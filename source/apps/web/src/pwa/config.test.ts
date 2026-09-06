import { describe, expect, it } from "vitest";

import { manifest, workbox } from "./config";

describe("PWA configuration", () => {
  it("defines an installable bilingual standalone application", () => {
    expect(manifest).toMatchObject({
      name: "LastDone · 记住上次，安排下次",
      short_name: "LastDone",
      display: "standalone",
      start_url: "/",
      theme_color: "#28745e",
      background_color: "#f3f7f5",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/pwa-192x192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/pwa-512x512.png", sizes: "512x512" }),
        expect.objectContaining({
          src: "/maskable-icon-512x512.png",
          purpose: "maskable",
        }),
      ]),
    );
  });

  it("uses an offline navigation shell without caching APIs", () => {
    expect(workbox.navigateFallback).toBe("/index.html");
    expect(
      workbox.navigateFallbackDenylist?.some((pattern) => pattern.test("/api/test")),
    ).toBe(true);
    expect(workbox.runtimeCaching?.[0]).toMatchObject({ handler: "NetworkFirst" });
    expect(workbox.importScripts).toContain("/push-handler.js");
  });
});
