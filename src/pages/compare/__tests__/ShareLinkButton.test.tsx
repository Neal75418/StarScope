import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ShareLinkButton } from "../ShareLinkButton";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      compare: {
        share: "Share",
        shareCopied: "Copied!",
      },
    },
  }),
}));

// Use a short feedback time for fast tests (real timers)
vi.mock("../../../constants/api", () => ({
  CLIPBOARD_FEEDBACK_MS: 150,
}));

describe("ShareLinkButton", () => {
  const origClipboard = navigator.clipboard;

  function mockClipboard(resolves: boolean) {
    const writeText = resolves
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error("Denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    return writeText;
  }

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: origClipboard,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("renders Share button", () => {
    render(<ShareLinkButton />);
    expect(screen.getByTestId("compare-share-btn")).toHaveTextContent("Share");
  });

  it("shows Copied! on successful clipboard write", async () => {
    const writeText = mockClipboard(true);
    render(<ShareLinkButton />);

    await userEvent.click(screen.getByTestId("compare-share-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("compare-share-btn")).toHaveTextContent("Copied!");
    });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it("reverts to Share after feedback timeout", async () => {
    mockClipboard(true);
    render(<ShareLinkButton />);

    await userEvent.click(screen.getByTestId("compare-share-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("compare-share-btn")).toHaveTextContent("Copied!");
    });

    // Wait for the mocked short timeout (150ms) to fire and revert
    await waitFor(
      () => {
        expect(screen.getByTestId("compare-share-btn")).toHaveTextContent("Share");
      },
      { timeout: 1000 }
    );
  });

  it("stays as Share when clipboard write fails", async () => {
    const writeText = mockClipboard(false);
    render(<ShareLinkButton />);

    await userEvent.click(screen.getByTestId("compare-share-btn"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(screen.getByTestId("compare-share-btn")).toHaveTextContent("Share");
  });

  it("cleans up timeout on unmount", async () => {
    mockClipboard(true);
    const { unmount } = render(<ShareLinkButton />);

    await userEvent.click(screen.getByTestId("compare-share-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("compare-share-btn")).toHaveTextContent("Copied!");
    });

    // Unmount while timeout is still pending — exercises useEffect cleanup
    unmount();
  });
});
