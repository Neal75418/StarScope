import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWatchlistKeyboard } from "../useWatchlistKeyboard";

describe("useWatchlistKeyboard", () => {
  const mockFocus = vi.fn();
  const mockRefreshAll = vi.fn();
  const mockAddRepo = vi.fn();

  function getOptions() {
    return {
      searchInputRef: { current: { focus: mockFocus } as unknown as HTMLInputElement },
      onRefreshAll: mockRefreshAll,
      onAddRepo: mockAddRepo,
    };
  }

  function fireKey(key: string, target?: EventTarget | null) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    if (target) {
      Object.defineProperty(event, "target", { value: target });
    }
    document.dispatchEvent(event);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any lingering listeners by unmounting
  });

  it("focuses search input on '/' key", () => {
    renderHook(() => useWatchlistKeyboard(getOptions()));
    fireKey("/");
    expect(mockFocus).toHaveBeenCalled();
  });

  it("calls onRefreshAll on 'r' key", () => {
    renderHook(() => useWatchlistKeyboard(getOptions()));
    fireKey("r");
    expect(mockRefreshAll).toHaveBeenCalled();
  });

  it("calls onAddRepo on 'a' key", () => {
    renderHook(() => useWatchlistKeyboard(getOptions()));
    fireKey("a");
    expect(mockAddRepo).toHaveBeenCalled();
  });

  it("ignores keydown inside input elements", () => {
    renderHook(() => useWatchlistKeyboard(getOptions()));
    const input = document.createElement("input");
    fireKey("/", input);
    expect(mockFocus).not.toHaveBeenCalled();
  });

  it("ignores keydown inside textarea elements", () => {
    renderHook(() => useWatchlistKeyboard(getOptions()));
    const textarea = document.createElement("textarea");
    fireKey("r", textarea);
    expect(mockRefreshAll).not.toHaveBeenCalled();
  });

  it("ignores keydown with modifier keys", () => {
    renderHook(() => useWatchlistKeyboard(getOptions()));
    const event = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
    expect(mockAddRepo).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    renderHook(() =>
      useWatchlistKeyboard({
        ...getOptions(),
        enabled: false,
      })
    );
    fireKey("/");
    expect(mockFocus).not.toHaveBeenCalled();
  });

  it("cleans up event listener on unmount", () => {
    const spy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useWatchlistKeyboard(getOptions()));
    unmount();
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
    spy.mockRestore();
  });
});
