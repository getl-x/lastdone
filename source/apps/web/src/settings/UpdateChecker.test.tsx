import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpdateCheckProvider } from "../native/UpdateCheckProvider";
import { UpdateChecker } from "./UpdateChecker";

const mocks = vi.hoisted(() => ({
  getInfo: vi.fn(async () => ({ version: "0.2.0" })),
  fetch: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({ App: { getInfo: mocks.getInfo } }));

function releaseResponse(tag: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      tag_name: tag,
      html_url: `https://github.com/getl-x/lastdone/releases/tag/${tag}`,
    }),
  };
}

function renderChecker(isAndroid: boolean) {
  return render(
    <UpdateCheckProvider isAndroid={isAndroid}>
      <UpdateChecker />
    </UpdateCheckProvider>,
  );
}

describe("UpdateChecker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.fetch.mockReset();
    mocks.getInfo.mockClear();
  });

  it("offers the download link when a newer release exists", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(releaseResponse("v0.3.0"));

    renderChecker(true);

    expect(await screen.findByText(/发现新版本/)).toHaveTextContent("0.3.0");
    expect(screen.getByText(/当前版本 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前往下载" })).toBeInTheDocument();
  });

  it("reports the installed version when no update is available", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(releaseResponse("v0.2.0"));

    renderChecker(true);

    expect(await screen.findByText(/已是最新版本 0\.2\.0/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "前往下载" })).not.toBeInTheDocument();
  });

  it("rechecks the release feed when the button is pressed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(releaseResponse("v0.3.0"));

    renderChecker(true);
    await screen.findByText(/发现新版本/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText(/发现新版本/)).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("skips the automatic check outside Android", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(releaseResponse("v0.3.0"));

    renderChecker(false);

    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/发现新版本/)).not.toBeInTheDocument();
  });
});
