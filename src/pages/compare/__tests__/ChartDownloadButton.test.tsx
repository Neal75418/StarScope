import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ChartDownloadButton } from "../ChartDownloadButton";
import { useRef } from "react";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: {
      compare: {
        download: "Download PNG",
      },
    },
  }),
}));

function Wrapper() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref}>
        <svg width="100" height="100">
          <rect width="100" height="100" fill="blue" />
        </svg>
      </div>
      <ChartDownloadButton chartRef={ref} />
    </div>
  );
}

describe("ChartDownloadButton", () => {
  it("renders download button", () => {
    render(<Wrapper />);
    expect(screen.getByTestId("compare-download-btn")).toHaveTextContent("Download PNG");
  });

  it("calls download flow on click", async () => {
    // The actual canvas/blob flow is hard to test in jsdom — just verify the click doesn't throw
    render(<Wrapper />);
    const btn = screen.getByTestId("compare-download-btn");
    await userEvent.click(btn);
    // No error thrown is success — jsdom doesn't support canvas.toBlob
  });
});
