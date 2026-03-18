import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrendsKeyboard } from "../useTrendsKeyboard";

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

describe("useTrendsKeyboard", () => {
  const onRefresh = vi.fn();
  const onToggleViewMode = vi.fn();
  const onSetSortBy = vi.fn();
  const onEscape = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderKeyboard(enabled = true) {
    return renderHook(() =>
      useTrendsKeyboard({
        onRefresh,
        onToggleViewMode,
        onSetSortBy,
        onEscape,
        enabled,
      })
    );
  }

  it("calls onRefresh on 'r' key", () => {
    renderKeyboard();
    fireKey("r");
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("calls onToggleViewMode on 'g' key", () => {
    renderKeyboard();
    fireKey("g");
    expect(onToggleViewMode).toHaveBeenCalledOnce();
  });

  it("calls onEscape on Escape key", () => {
    renderKeyboard();
    fireKey("Escape");
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("calls onSetSortBy with velocity on '1' key", () => {
    renderKeyboard();
    fireKey("1");
    expect(onSetSortBy).toHaveBeenCalledWith("velocity");
  });

  it("calls onSetSortBy with stars_delta_7d on '2' key", () => {
    renderKeyboard();
    fireKey("2");
    expect(onSetSortBy).toHaveBeenCalledWith("stars_delta_7d");
  });

  it("calls onSetSortBy with stars_delta_30d on '3' key", () => {
    renderKeyboard();
    fireKey("3");
    expect(onSetSortBy).toHaveBeenCalledWith("stars_delta_30d");
  });

  it("calls onSetSortBy with acceleration on '4' key", () => {
    renderKeyboard();
    fireKey("4");
    expect(onSetSortBy).toHaveBeenCalledWith("acceleration");
  });

  it("calls onSetSortBy with forks_delta_7d on '5' key", () => {
    renderKeyboard();
    fireKey("5");
    expect(onSetSortBy).toHaveBeenCalledWith("forks_delta_7d");
  });

  it("calls onSetSortBy with issues_delta_7d on '6' key", () => {
    renderKeyboard();
    fireKey("6");
    expect(onSetSortBy).toHaveBeenCalledWith("issues_delta_7d");
  });

  it("ignores keys with meta modifier", () => {
    renderKeyboard();
    fireKey("r", { metaKey: true });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores keys with ctrl modifier", () => {
    renderKeyboard();
    fireKey("r", { ctrlKey: true });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores keys with alt modifier", () => {
    renderKeyboard();
    fireKey("r", { altKey: true });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores keys when target is an input", () => {
    renderKeyboard();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(onRefresh).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("ignores keys when target is a select", () => {
    renderKeyboard();
    const select = document.createElement("select");
    document.body.appendChild(select);
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(onToggleViewMode).not.toHaveBeenCalled();
    document.body.removeChild(select);
  });

  it("does nothing when disabled", () => {
    renderKeyboard(false);
    fireKey("r");
    fireKey("g");
    fireKey("1");
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onToggleViewMode).not.toHaveBeenCalled();
    expect(onSetSortBy).not.toHaveBeenCalled();
  });

  it("does not respond to unmapped keys", () => {
    renderKeyboard();
    fireKey("x");
    fireKey("7");
    fireKey("0");
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onToggleViewMode).not.toHaveBeenCalled();
    expect(onSetSortBy).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
  });
});
