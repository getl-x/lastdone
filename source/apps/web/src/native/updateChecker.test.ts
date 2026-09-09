import { describe, expect, it, vi } from "vitest";

import {
  RELEASES_PAGE_URL,
  checkForUpdate,
  compareVersions,
  fetchLatestRelease,
  isComparableVersion,
  normalizeVersion,
} from "./updateChecker";

function stubFetch(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("normalizeVersion", () => {
  it("strips a leading v and surrounding whitespace", () => {
    expect(normalizeVersion(" v0.2.0 ")).toBe("0.2.0");
    expect(normalizeVersion("0.2.0")).toBe("0.2.0");
  });
});

describe("isComparableVersion", () => {
  it("accepts dotted numeric versions and rejects dev builds", () => {
    expect(isComparableVersion("v0.2.0")).toBe(true);
    expect(isComparableVersion("0.2")).toBe(true);
    expect(isComparableVersion("dev")).toBe(false);
    expect(isComparableVersion("0.2.0-beta.1")).toBe(false);
  });
});

describe("compareVersions", () => {
  it("orders releases by numeric segments", () => {
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("1.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
  });

  it("ignores prerelease suffixes when comparing core versions", () => {
    expect(compareVersions("0.3.0-beta.1", "0.2.9")).toBe(1);
    expect(compareVersions("0.3.0-beta.1", "0.3.0")).toBe(0);
  });
});

describe("fetchLatestRelease", () => {
  it("maps the GitHub payload into a release", async () => {
    const fetchImpl = stubFetch({
      tag_name: "v0.3.0",
      name: "LastDone v0.3.0",
      published_at: "2026-09-10T00:00:00Z",
      html_url: "https://github.com/getl-x/lastdone/releases/tag/v0.3.0",
    });

    await expect(fetchLatestRelease(fetchImpl)).resolves.toEqual({
      version: "0.3.0",
      name: "LastDone v0.3.0",
      publishedAt: "2026-09-10T00:00:00Z",
      htmlUrl: "https://github.com/getl-x/lastdone/releases/tag/v0.3.0",
    });
  });

  it("falls back to the releases page when html_url is missing", async () => {
    const fetchImpl = stubFetch({ tag_name: "v0.3.0" });

    await expect(fetchLatestRelease(fetchImpl)).resolves.toEqual({
      version: "0.3.0",
      name: null,
      publishedAt: null,
      htmlUrl: RELEASES_PAGE_URL,
    });
  });

  it("rejects when the response is not ok", async () => {
    const fetchImpl = stubFetch({}, { ok: false, status: 403 });

    await expect(fetchLatestRelease(fetchImpl)).rejects.toThrow(
      "GitHub releases request failed with 403",
    );
  });

  it("rejects when tag_name is missing", async () => {
    const fetchImpl = stubFetch({});

    await expect(fetchLatestRelease(fetchImpl)).rejects.toThrow("missing tag_name");
  });
});

describe("checkForUpdate", () => {
  it("flags an update when the latest release is newer", async () => {
    const fetchImpl = stubFetch({ tag_name: "v0.3.0" });

    await expect(checkForUpdate("0.2.0", fetchImpl)).resolves.toMatchObject({
      currentVersion: "0.2.0",
      updateAvailable: true,
      latest: { version: "0.3.0" },
    });
  });

  it("reports no update for the same release", async () => {
    const fetchImpl = stubFetch({ tag_name: "v0.2.0" });

    await expect(checkForUpdate("0.2.0", fetchImpl)).resolves.toMatchObject({
      updateAvailable: false,
    });
  });
});
