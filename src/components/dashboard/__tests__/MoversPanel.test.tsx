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
    const { container } = render(<MoversPanel result={base} />);
    expect(screen.getByTestId("movers-divider")).toBeInTheDocument();

    // 只驗證線存在還不夠：線兩側都要有真的列，且不能左右歸類顛倒——
    // 否則「above 整組沒畫出來」或「above/below 判斷寫反」照樣是綠的
    const order = Array.from(
      container.querySelectorAll('[data-testid="mover-row"], [data-testid="movers-divider"]')
    ).map((el) =>
      el.getAttribute("data-testid") === "movers-divider" ? "divider" : el.textContent
    );
    expect(order).toHaveLength(3);
    expect(order[0]).toContain("a/one");
    expect(order[1]).toBe("divider");
    expect(order[2]).toContain("b/two");
  });

  it("中位數為零時不畫線", () => {
    // 沒有東西稱得上顯著，就不要假裝有分界。
    // 混入一顆非正值的 relative：真實 risers 只會是正值（computeMovers 已濾過），
    // 但元件對 null 門檻的特判要能獨立扛住驗證——兩顆都給正值的話，null 被當數字
    // 比較會巧合等於 0，below 照樣算出空陣列，測不出特判被拿掉。
    const risers = [...base.risers, mover("d/four", -0.01, -5)];
    render(<MoversPanel result={{ ...base, risers, threshold: null }} />);
    expect(screen.queryByTestId("movers-divider")).not.toBeInTheDocument();
    expect(screen.getByText("d/four")).toBeInTheDocument();
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

  it("沒有下滑者時不顯示折疊區", () => {
    // 空的「下滑中（0）」正是這個面板一直想避免的雜訊——沒有下滑者就不該有這一區
    render(<MoversPanel result={base} />);
    expect(screen.queryByTestId("movers-fallers")).not.toBeInTheDocument();
  });

  it("下滑中另組並預設折疊", () => {
    // 用兩個以上的下滑者：數字要跟畫面上其他數字（例如視窗「1」）不同，
    // 才驗證得出摘要文字裡的計數真的來自 fallers.length，而不是巧合湊對、
    // 或是被寫死成別的數字也測不出來
    const fallers = [mover("c/three", -0.02, -20), mover("e/five", -0.03, -30)];
    render(<MoversPanel result={{ ...base, fallers }} />);

    const details = screen.getByTestId("movers-fallers");
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("c/three")).toBeInTheDocument();
    expect(within(details).getByText("e/five")).toBeInTheDocument();
    expect(details).toHaveTextContent("Declining (2)");
  });

  it("正負相對成長分別套上 up/down 顏色 modifier", () => {
    // class 沒套對就等於「漲跌看起來一樣」——這是唯一分辨兩者的視覺線索。
    // 這個面板先前就出過 class 名稱和實際 CSS 規則對不上、悄悄不生效的例子
    // （trend-up/trend-down 只在 .stat-value 底下生效），所以在這裡把類名釘死。
    const { container } = render(
      <MoversPanel result={{ ...base, fallers: [mover("c/three", -0.02, -20)] }} />
    );
    expect(container.querySelector(".mover-relative--up")).toHaveTextContent("+7.74%");
    expect(container.querySelector(".mover-relative--down")).toHaveTextContent("-2.00%");
  });
});
