import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MoversPanel } from "../MoversPanel";
import type { MoversResult } from "../../../utils/movers";
import type { RepoWithSignals } from "../../../api/types";

function mover(fullName: string, relative: number, delta: number) {
  return { repo: { full_name: fullName } as RepoWithSignals, delta, relative };
}

const base: MoversResult = {
  window: 1,
  risers: [mover("a/one", 0.0774, 8819), mover("b/two", 0.0006, 26)],
  fallers: [],
  threshold: 0.001,
  totalDelta: 9892,
};

describe("MoversPanel", () => {
  it("標題帶著窗口，因為兩個窗口的數字不能同名", () => {
    render(<MoversPanel result={base} />);
    expect(screen.getByTestId("movers-title")).toHaveTextContent(/1/);

    render(<MoversPanel result={{ ...base, window: 7 }} />);
    expect(screen.getAllByTestId("movers-title")[1]).toHaveTextContent(/7/);
  });

  it("標題帶著總增量", () => {
    render(<MoversPanel result={base} />);
    expect(screen.getByTestId("movers-title")).toHaveTextContent("+9.9K");
  });

  it("門檻以上與以下之間畫一條線", () => {
    render(<MoversPanel result={base} />);
    expect(screen.getByTestId("movers-divider")).toBeInTheDocument();
  });

  it("中位數為零時不畫線", () => {
    // 沒有東西稱得上顯著，就不要假裝有分界
    render(<MoversPanel result={{ ...base, threshold: null }} />);
    expect(screen.queryByTestId("movers-divider")).not.toBeInTheDocument();
  });

  it("全部都在門檻以上時不畫線", () => {
    render(<MoversPanel result={{ ...base, threshold: 0.00001 }} />);
    expect(screen.queryByTestId("movers-divider")).not.toBeInTheDocument();
  });

  it("沒有任何窗口有資料時說資料累積中", () => {
    render(
      <MoversPanel
        result={{ window: null, risers: [], fallers: [], threshold: null, totalDelta: null }}
      />
    );
    expect(screen.getByTestId("movers-empty")).toBeInTheDocument();
  });

  it("下滑中另組並預設折疊", () => {
    render(<MoversPanel result={{ ...base, fallers: [mover("c/three", -0.02, -20)] }} />);

    const details = screen.getByTestId("movers-fallers");
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("c/three")).toBeInTheDocument();
  });
});
