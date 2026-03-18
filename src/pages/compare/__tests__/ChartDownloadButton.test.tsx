import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ChartDownloadButton } from "../ChartDownloadButton";
import { useRef } from "react";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: { compare: { download: "Download PNG" } },
  }),
}));

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

  function mockImageTrigger(event: "onload" | "onerror") {
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
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

  it("completes full SVG-to-PNG download flow", async () => {
    mockImageTrigger("onload");
    const clickSpy = vi.fn();
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
        if (tag === "a") {
          const a = origCreateElement("a");
          a.click = clickSpy;
          return a;
        }
        return origCreateElement(tag, options);
      }
    );

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(mockCtx.scale).toHaveBeenCalledWith(2, 2);
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(mockToBlob).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("handles img.onerror gracefully", async () => {
    mockImageTrigger("onerror");

    render(<Wrapper />);
    await userEvent.click(screen.getByTestId("compare-download-btn"));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
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

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
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
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
