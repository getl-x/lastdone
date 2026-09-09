const RELEASE_REPOSITORY = "getl-x/lastdone";
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;

export const RELEASES_PAGE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/latest`;

export interface LatestRelease {
  version: string;
  name: string | null;
  publishedAt: string | null;
  htmlUrl: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latest: LatestRelease;
  updateAvailable: boolean;
}

interface GithubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
}

export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

export function isComparableVersion(value: string): boolean {
  return /^\d+(\.\d+)*$/.test(normalizeVersion(value));
}

function versionParts(value: string): number[] {
  const [core = ""] = normalizeVersion(value).split("-");

  return core.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }

  return 0;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<LatestRelease> {
  const response = await fetchImpl(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    throw new Error(`GitHub releases request failed with ${response.status}`);
  }

  const payload = (await response.json()) as GithubReleasePayload;
  const version = normalizeVersion(optionalString(payload.tag_name) ?? "");
  if (version === "") {
    throw new Error("GitHub releases response is missing tag_name");
  }

  return {
    version,
    name: optionalString(payload.name),
    publishedAt: optionalString(payload.published_at),
    htmlUrl: optionalString(payload.html_url) ?? RELEASES_PAGE_URL,
  };
}

export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const latest = await fetchLatestRelease(fetchImpl);

  return {
    currentVersion: normalizeVersion(currentVersion),
    latest,
    updateAvailable: compareVersions(latest.version, currentVersion) > 0,
  };
}
