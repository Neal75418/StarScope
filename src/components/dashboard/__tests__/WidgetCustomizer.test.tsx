/**
 * WidgetCustomizer 元件測試。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetCustomizer, WidgetVisibility, loadWidgetVisibility } from "../WidgetCustomizer";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const defaultVisibility: WidgetVisibility = {
  statsGrid: true,
  signalSpotlight: true,
  weeklySummary: true,
  portfolioHistory: true,
  velocityChart: true,
  languageDistribution: true,
  categorySummary: true,
  recentActivity: true,
};

describe("WidgetCustomizer", () => {
  it("opens dropdown on button click", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("renders checkboxes for each widget", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    // 對 defaultVisibility 的鍵數，不寫死數字：這條要守的是「每個 widget 都有開關」，
    // 而不是「目前剛好有 N 個 widget」。寫死的話每次增刪 widget 都得改測試，
    // 卻擋不住「某個 widget 沒有開關」這件真正該擋的事。
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(Object.keys(defaultVisibility).length);
    expect(checkboxes[0]).toBeChecked();
  });

  it("calls onChange when checkbox toggled", () => {
    const onChange = vi.fn();
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));
    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(firstCheckbox);

    expect(onChange).toHaveBeenCalledTimes(1);
    // 不綁特定 widget：原本斷言的是 portfolioHealth，因為它剛好排第一。
    // 改成「剛好一個鍵翻轉、其餘不動」之後，清單增刪或重排都不會弄壞這條。
    const newVisibility = onChange.mock.calls[0][0] as WidgetVisibility;
    const changed = (Object.keys(defaultVisibility) as (keyof WidgetVisibility)[]).filter(
      (k) => newVisibility[k] !== defaultVisibility[k]
    );
    expect(changed).toHaveLength(1);
    expect(newVisibility[changed[0]]).toBe(!defaultVisibility[changed[0]]);
  });

  it("uses role='group' not role='menu'", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("sets aria-expanded on trigger button", () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);
    const btn = screen.getByRole("button");

    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on ESC key", async () => {
    render(<WidgetCustomizer visibility={defaultVisibility} onChange={vi.fn()} />);
    const btn = screen.getByRole("button");

    fireEvent.click(btn);
    expect(screen.getByRole("group")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("換過 storage key，舊偏好不影響新版面", () => {
    // 版面的 widget 組成整個變了，寫在舊 key 底下的偏好對不上新版面，
    // 讀到才是 bug——STORAGE_KEY 忘了跟著版面一起換版本就會在這裡露餡。
    // 先清空：前面「calls onChange when checkbox toggled」那條測試會透過真的
    // saveWidgetVisibility 把切換後的值寫進新 key，不清掉會撞見上一條測試的殘留。
    localStorage.clear();
    localStorage.setItem("starscope-dashboard-widgets", JSON.stringify({ recentActivity: true }));
    expect(loadWidgetVisibility().recentActivity).toBe(false);
  });

  it("statsGrid 預設關閉——四張卡的數字有了新去處，但排不排這一排仍是使用者的判斷", () => {
    localStorage.clear();
    expect(loadWidgetVisibility().statsGrid).toBe(false);
  });
});
