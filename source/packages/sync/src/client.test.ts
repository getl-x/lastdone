import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpSyncTransport } from "./client";

describe("HTTP sync transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the browser fetch implementation with the global receiver", async () => {
    const browserFetch = vi.fn(function (this: typeof globalThis) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            changes: [],
            conflicts: [],
            nextSequence: 0,
            hasMore: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", browserFetch);

    const transport = new HttpSyncTransport({
      getToken: () => "test-token",
    });
    await expect(transport.pull(0, 500)).resolves.toMatchObject({
      nextSequence: 0,
      hasMore: false,
    });
  });
});
