import { describe, expect, it, vi } from "vitest";

import { normalizeServerOrigin, verifyLastDoneServer } from "./serverOrigin";

describe("normalizeServerOrigin", () => {
  it("accepts an HTTPS origin and removes the trailing slash", () => {
    expect(normalizeServerOrigin(" https://lastdone.example.com/ ")).toBe(
      "https://lastdone.example.com",
    );
  });

  it.each([
    "http://lastdone.example.com",
    "https://user:password@lastdone.example.com",
    "https://lastdone.example.com/path",
    "https://lastdone.example.com/?preview=true",
  ])("rejects an unsafe or non-origin address: %s", (value) => {
    expect(() => normalizeServerOrigin(value)).toThrow();
  });
});

describe("verifyLastDoneServer", () => {
  it("accepts a healthy LastDone endpoint", async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    await expect(
      verifyLastDoneServer("https://lastdone.example.com", request),
    ).resolves.toBeUndefined();
  });

  it("rejects a different service", async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ status: "unknown" }), { status: 200 }),
    );
    await expect(
      verifyLastDoneServer("https://lastdone.example.com", request),
    ).rejects.toThrow("不是可用的 LastDone");
  });
});
