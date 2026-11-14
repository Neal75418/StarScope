/**
 * useEscapeKey 的單元測試
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, fireEvent } from "@testing-library/react";
import { useEscapeKey } from "../useEscapeKey";

/** 對話框的形狀：按鍵從框內的輸入框送出，框本身擋掉 keydown 往上傳 */
function mountInputInsideGuardedBox(): HTMLInputElement {
  const box = document.createElement("div");
  box.addEventListener("keydown", (e) => e.stopPropagation());
  const input = document.createElement("input");
  box.appendChild(input);
  document.body.appendChild(box);
  return input;
}

describe("useEscapeKey", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("fires when an ancestor of the event target stops keydown propagation", () => {
    const handler = vi.fn();
    renderHook(() => useEscapeKey(handler));

    fireEvent.keyDown(mountInputInsideGuardedBox(), { key: "Escape" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while an input method is composing", () => {
    const handler = vi.fn();
    renderHook(() => useEscapeKey(handler));

    fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores the Escape that an input method consumed (keyCode 229)", () => {
    const handler = vi.fn();
    renderHook(() => useEscapeKey(handler));

    fireEvent.keyDown(document.body, { key: "Escape", keyCode: 229 });

    expect(handler).not.toHaveBeenCalled();
  });
});
