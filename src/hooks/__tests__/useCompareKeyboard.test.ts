import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCompareKeyboard } from "../useCompareKeyboard";

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

describe("useCompareKeyboard", () => {
  const onToggleNormalize = vi.fn();
  const onSetMetric = vi.fn();
  const onSetChartType = vi.fn();
  const onSetTimeRange = vi.fn();
  const onDownload = vi.fn();
  const onToggleLogScale = vi.fn();
  const onToggleGrowthRate = vi.fn();
  const onEscape = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderKeyboard(enabled = true) {
    return renderHook(() =>
      useCompareKeyboard({
        onToggleNormalize,
        onSetMetric,
        onSetChartType,
        onSetTimeRange,
        onDownload,
        onToggleLogScale,
        onToggleGrowthRate,
        onEscape,
        enabled,
      })
    );
  }

  it("calls onToggleNormalize on 'n' key", () => {
    renderKeyboard();
    fireKey("n");
    expect(onToggleNormalize).toHaveBeenCalledOnce();
  });

  it("calls onSetMetric('stars') on 's' key", () => {
    renderKeyboard();
    fireKey("s");
    expect(onSetMetric).toHaveBeenCalledWith("stars");
  });

  it("calls onSetMetric('forks') on 'f' key", () => {
    renderKeyboard();
    fireKey("f");
    expect(onSetMetric).toHaveBeenCalledWith("forks");
  });

  it("calls onSetChartType('line') on 'l' key", () => {
    renderKeyboard();
    fireKey("l");
    expect(onSetChartType).toHaveBeenCalledWith("line");
  });

  it("calls onSetChartType('area') on 'a' key", () => {
    renderKeyboard();
    fireKey("a");
    expect(onSetChartType).toHaveBeenCalledWith("area");
  });

  it("calls onDownload on 'd' key", () => {
    renderKeyboard();
    fireKey("d");
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("calls onEscape on Escape key", () => {
    renderKeyboard();
    fireKey("Escape");
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("calls onSetTimeRange('7d') on '1' key", () => {
    renderKeyboard();
    fireKey("1");
    expect(onSetTimeRange).toHaveBeenCalledWith("7d");
  });

  it("calls onSetTimeRange('30d') on '2' key", () => {
    renderKeyboard();
    fireKey("2");
    expect(onSetTimeRange).toHaveBeenCalledWith("30d");
  });

  it("calls onSetTimeRange('90d') on '3' key", () => {
    renderKeyboard();
    fireKey("3");
    expect(onSetTimeRange).toHaveBeenCalledWith("90d");
  });

  it("calls onSetTimeRange('all') on '4' key", () => {
    renderKeyboard();
    fireKey("4");
    expect(onSetTimeRange).toHaveBeenCalledWith("all");
  });

  it("ignores keys with meta modifier", () => {
    renderKeyboard();
    fireKey("n", { metaKey: true });
    expect(onToggleNormalize).not.toHaveBeenCalled();
  });

  it("ignores keys with ctrl modifier", () => {
    renderKeyboard();
    fireKey("s", { ctrlKey: true });
    expect(onSetMetric).not.toHaveBeenCalled();
  });

  it("ignores keys with alt modifier", () => {
    renderKeyboard();
    fireKey("d", { altKey: true });
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("ignores keys when target is an input", () => {
    renderKeyboard();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    expect(onToggleNormalize).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("ignores keys when target is a textarea", () => {
    renderKeyboard();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    expect(onSetMetric).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it("does nothing when disabled", () => {
    renderKeyboard(false);
    fireKey("n");
    fireKey("s");
    fireKey("1");
    fireKey("d");
    expect(onToggleNormalize).not.toHaveBeenCalled();
    expect(onSetMetric).not.toHaveBeenCalled();
    expect(onSetTimeRange).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("does not respond to unmapped keys", () => {
    renderKeyboard();
    fireKey("x");
    fireKey("7");
    fireKey("0");
    expect(onToggleNormalize).not.toHaveBeenCalled();
    expect(onSetMetric).not.toHaveBeenCalled();
    expect(onSetChartType).not.toHaveBeenCalled();
    expect(onSetTimeRange).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
  });
});
