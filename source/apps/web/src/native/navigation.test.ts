import { describe, expect, it, vi } from "vitest";

import {
  normalizeAppRoute,
  requestNativeNavigation,
  subscribeToNativeNavigation,
} from "./navigation";

describe("native navigation", () => {
  it("accepts only internal application routes", () => {
    expect(normalizeAppRoute("/items/item-1?from=notification")).toBe(
      "/items/item-1?from=notification",
    );
    expect(normalizeAppRoute("https://example.com/items/item-1")).toBeNull();
    expect(normalizeAppRoute("//example.com/items/item-1")).toBeNull();
  });

  it("delivers a pending notification route when the router subscribes", async () => {
    const listener = vi.fn();
    requestNativeNavigation("/items/item-1");
    const unsubscribe = subscribeToNativeNavigation(listener);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith("/items/item-1");
    unsubscribe();
  });
});
