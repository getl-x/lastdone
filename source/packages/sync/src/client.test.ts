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

  it("sends an authenticated conflict resolution request", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "operation-1:name",
            userId: "user-1",
            entity: "items",
            entityId: "item-1",
            field: "name",
            localValue: "本机名称",
            serverValue: "服务器名称",
            serverRevision: 2,
            status: "resolved",
            createdAt: "2026-09-06T08:00:00Z",
            resolvedAt: "2026-09-06T08:05:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const transport = new HttpSyncTransport({
      baseUrl: "https://lastdone.example.com",
      getToken: () => "test-token",
      fetch: request,
    });

    await expect(
      transport.resolveConflict("operation-1:name", "local"),
    ).resolves.toMatchObject({ status: "resolved" });
    expect(request).toHaveBeenCalledWith(
      "https://lastdone.example.com/api/lastdone/sync/conflicts/operation-1%3Aname/resolve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ choice: "local" }),
        headers: expect.objectContaining({ Authorization: "test-token" }),
      }),
    );
  });
});
