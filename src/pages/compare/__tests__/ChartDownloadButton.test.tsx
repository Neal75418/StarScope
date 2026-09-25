import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ChartDownloadButton } from "../ChartDownloadButton";
import { useRef } from "react";
import { saveFile } from "../../../utils/saveFile";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: { compare: { download: "Download PNG", downloadFailed: "Download failed" } },
  }),
}));

vi.mock("../../../utils/saveFile", () => ({ saveFile: vi.fn() }));

// 真實 Compare 頁的結構：Recharts 的圖例色點也是 svg.recharts-surface（14×14），
// 在 DOM 裡排在主圖表前面。只取第一個 svg 的話，下載到的是 28×28 的色點
function RechartsLikeWrapper() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref}>
        <div className="recharts-wrapper">
          <div className="recharts-legend-wrapper">
            <svg className="recharts-surface" width="14" height="14" data-part="legend-dot">
              <circle r="4" />
            </svg>
          </div>
          <svg className="recharts-surface" width="887" height="350" data-part="main-chart">
            <path d="M0 0L10 10" />
          </svg>
        </div>
      </div>
      <ChartDownloadButton chartRef={ref} />
    </div>
  );
}

function Wrapper({ includeSvg = true }: { includeSvg?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref}>
        {includeSvg && (
          <svg width="100" height="100">
            <rect width="100" height="100" fill="blue" />
          </svg>
        )}
      </div>
      <ChartDownloadButton chartRef={ref} />
    </div>
  );
}

describe("ChartDownloadButton", () => {
  const origImage = globalThis.Image;
  const origCreateElement = document.createElement.bind(document);
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;

  const imageSources: string[] = [];

  function mockImageTrigger(event: "onload" | "onerror") {
    imageSources.length = 0;
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        imageSources.push(value);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        queueMicrotask(() => {
          if (event === "onload") self.onload?.();
          else self.onerror?.();
        });
      }
    } as unknown as typeof Image;
  }

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
    URL.revokeObjectURL = vi.fn();
    // restoreAllMocks 只還原 spyOn，vi.mock 工廠建的 mock 要自己清，否則呼叫次數跨測試累積
    vi.mocked(saveFile).mockReset();
    vi.mocked(saveFile).mockResolvedValue("saved");
  });

  afterEach(() => {
    globalThis.Image = origImage;
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("renders download button", () => {
    render(<Wrapper />);
    expect(screen.getByTestId("compare-download-btn")).toHaveTextContent("Download PNG");
  });

  it("does nothing when container has no SVG", async () => {
    render(<Wrapper includeSvg={false} />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  function mockCanvas() {
    const mockCtx = { scale: vi.fn(), drawImage: vi.fn() };
    const mockToBlob = vi.fn((cb: (blob: Blob | null) => void) =>
      cb(new Blob(["png"], { type: "image/png" }))
    );
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => mockCtx,
            toBlob: mockToBlob,
          } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tag, options);
      }
    );
    return { mockCtx, mockToBlob };
  }

  it("completes full SVG-to-PNG flow and hands the PNG bytes to saveFile", async () => {
    // 不用 <a download>：wry 在 macOS 上沒有 download handler 時會直接取消下載，按了沒反應
    mockImageTrigger("onload");
    const { mockCtx, mockToBlob } = mockCanvas();

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    const [name, bytes] = vi.mocked(saveFile).mock.calls[0];
    expect(name).toBe("comparison-chart.png");
    expect(Array.from(bytes as Uint8Array)).toEqual(Array.from(new TextEncoder().encode("png")));
    expect(mockCtx.scale).toHaveBeenCalledWith(2, 2);
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(mockToBlob).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads the SVG as a data: URL, which the app's CSP allows (blob: is not in img-src)", async () => {
    // tauri.conf.json 的 img-src 只允許 'self' data: 與兩個 GitHub 網域：blob: 圖片在正式版會被擋，
    // 按下載只會看到失敗。單元測試與 Vite 下的 e2e 都沒有 CSP，所以要在這裡斷言來源
    mockImageTrigger("onload");
    mockCanvas();

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(imageSources).toHaveLength(1));
    expect(imageSources[0]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(imageSources[0].split(",")[1])).toContain("<rect");
  });

  it("renders the main chart, not the first legend dot", async () => {
    mockImageTrigger("onload");
    mockCanvas();

    render(<RechartsLikeWrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(imageSources).toHaveLength(1));
    const svg = decodeURIComponent(imageSources[0].split(",")[1]);
    expect(svg).toContain('data-part="main-chart"');
    expect(svg).not.toContain('data-part="legend-dot"');
  });

  it("shows the error when reading the PNG bytes fails", async () => {
    mockImageTrigger("onload");
    mockCanvas();
    const origFileReader = globalThis.FileReader;
    globalThis.FileReader = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error = new Error("read failed");
      readAsArrayBuffer() {
        queueMicrotask(() => this.onerror?.());
      }
    } as unknown as typeof FileReader;

    try {
      render(<Wrapper />);
      await userEvent.click(screen.getByTestId("compare-download-btn"));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Download failed"));
      expect(saveFile).not.toHaveBeenCalled();
    } finally {
      // 斷言失敗也要還原，否則假的 FileReader 會洩漏到後面的測試
      globalThis.FileReader = origFileReader;
    }
  });

  it("shows the error when saving fails", async () => {
    mockImageTrigger("onload");
    mockCanvas();
    vi.mocked(saveFile).mockRejectedValue("Permission denied");

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Download failed"));
  });

  it("does not show an error when the user cancels the save dialog", async () => {
    mockImageTrigger("onload");
    mockCanvas();
    vi.mocked(saveFile).mockResolvedValue("cancelled");

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("handles img.onerror gracefully", async () => {
    mockImageTrigger("onerror");

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Download failed"));
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("handles null canvas context", async () => {
    mockImageTrigger("onload");

    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => null,
            toBlob: vi.fn(),
          } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tag, options);
      }
    );

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Download failed"));
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("handles null blob from toBlob", async () => {
    mockImageTrigger("onload");
    const mockCtx = { scale: vi.fn(), drawImage: vi.fn() };
    const mockToBlob = vi.fn((cb: (blob: Blob | null) => void) => cb(null));

    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => mockCtx,
            toBlob: mockToBlob,
          } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tag, options);
      }
    );

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(mockToBlob).toHaveBeenCalled());
    // Only the SVG blob URL should be created, not a PNG blob URL
    // SVG 走 data: URL，不建 blob；toBlob 給 null 時要回報錯誤、不去存檔
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Download failed"));
    expect(saveFile).not.toHaveBeenCalled();
  });
});
