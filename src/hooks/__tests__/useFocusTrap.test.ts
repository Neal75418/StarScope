import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFocusTrap } from "../useFocusTrap";

function createContainer(...elements: string[]): HTMLDivElement {
  const container = document.createElement("div");
  for (const tag of elements) {
    const el = document.createElement(tag);
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return container;
}

function pressTab(shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
  });
  document.dispatchEvent(event);
}

/** 從指定元素送出 Tab（真實按鍵的形狀：事件由焦點所在的元素往上傳），回傳事件供檢查 defaultPrevented */
function pressTabOn(target: EventTarget, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function renderTrap(container: HTMLDivElement, isActive: boolean, autoFocus?: boolean) {
  return renderHook(() => {
    const ref = useFocusTrap(isActive, autoFocus);
    (ref as { current: HTMLDivElement | null }).current = container;
    return ref;
  });
}

describe("useFocusTrap", () => {
  afterEach(() => {
    // Clean up DOM by removing all children
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("returns a ref object", () => {
    const { result } = renderHook(() => useFocusTrap(false));
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it("auto-focuses first focusable element when active", () => {
    const container = createContainer("button", "input", "button");
    const firstBtn = container.querySelectorAll("button")[0];

    renderTrap(container, true);

    expect(document.activeElement).toBe(firstBtn);
  });

  it("skips auto-focus when autoFocus is false", () => {
    const container = createContainer("button", "input");
    document.body.focus();

    renderTrap(container, true, false);

    expect(document.activeElement).not.toBe(container.querySelector("button"));
  });

  it("wraps focus from last to first on Tab", () => {
    const container = createContainer("button", "button");
    const buttons = container.querySelectorAll("button");

    renderTrap(container, true);

    act(() => {
      buttons[1].focus();
    });
    expect(document.activeElement).toBe(buttons[1]);

    act(() => {
      pressTab();
    });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps focus from first to last on Shift+Tab", () => {
    const container = createContainer("button", "button");
    const buttons = container.querySelectorAll("button");

    renderTrap(container, true);

    act(() => {
      buttons[0].focus();
    });
    expect(document.activeElement).toBe(buttons[0]);

    act(() => {
      pressTab(true);
    });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("does nothing when not active", () => {
    const container = createContainer("button", "button");

    renderTrap(container, false);

    expect(document.activeElement).toBe(document.body);
  });

  it("does not trap when non-Tab key is pressed", () => {
    const container = createContainer("button", "button");
    const buttons = container.querySelectorAll("button");

    renderTrap(container, true);

    act(() => {
      buttons[1].focus();
    });

    const spy = vi.spyOn(KeyboardEvent.prototype, "preventDefault");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("blocks Tab when the container has nothing focusable", () => {
    // 確認框處理中：兩顆按鈕都停用，焦點落在 body。Tab 不能走到框後面的頁面
    const container = createContainer("button", "button");
    container.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    renderTrap(container, true, false);

    let event!: KeyboardEvent;
    act(() => {
      event = pressTabOn(document.body);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("pulls focus back to the first element on Tab when focus is outside the container", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const container = createContainer("button", "button");
    const buttons = container.querySelectorAll("button");

    renderTrap(container, true, false);
    act(() => {
      outside.focus();
    });

    let event!: KeyboardEvent;
    act(() => {
      event = pressTabOn(outside);
    });
    expect(document.activeElement).toBe(buttons[0]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("pulls focus back to the last element on Shift+Tab when focus is outside the container", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const container = createContainer("button", "button");
    const buttons = container.querySelectorAll("button");

    renderTrap(container, true, false);
    act(() => {
      outside.focus();
    });

    act(() => {
      pressTabOn(outside, true);
    });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("restores focus on cleanup", () => {
    const container = createContainer("button");
    const externalBtn = document.createElement("button");
    externalBtn.id = "external";
    document.body.appendChild(externalBtn);

    act(() => {
      externalBtn.focus();
    });
    expect(document.activeElement).toBe(externalBtn);

    const { unmount } = renderTrap(container, true);

    expect(document.activeElement).toBe(container.querySelector("button"));

    act(() => {
      unmount();
    });
    expect(document.activeElement).toBe(externalBtn);
  });

  it("does not wrap Tab when focus is in the middle", () => {
    const container = createContainer("button", "input", "button");
    const input = container.querySelector("input");

    renderTrap(container, true);

    act(() => {
      input?.focus();
    });
    expect(document.activeElement).toBe(input);

    const spy = vi.spyOn(KeyboardEvent.prototype, "preventDefault");
    act(() => {
      pressTab();
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("restores focus without scrolling the page", () => {
    // 元素在對話框打開前就在視野內，.focus() 預設會把它捲進視野——關閉確認框時
    // 把頁面捲走，使用者突然找不到自己剛操作的那一列。
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const focusSpy = vi.spyOn(trigger, "focus");

    const container = createContainer("button");
    document.body.appendChild(container);
    const { unmount } = renderTrap(container, true, false);
    unmount();

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    trigger.remove();
  });

  it("leaves Tab alone inside a dialog opened on top of another one", () => {
    // 兩個對話框疊著時只有最上層的管 Tab：底下那個看到焦點「在自己框外」，不能把它搶回去
    const lower = createContainer("button", "button");
    const upper = createContainer("button", "button", "button");
    const upperButtons = upper.querySelectorAll("button");

    renderTrap(lower, true, false);
    renderTrap(upper, true, false);
    act(() => {
      upperButtons[1].focus();
    });

    let event!: KeyboardEvent;
    act(() => {
      event = pressTabOn(upperButtons[1]);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(upperButtons[1]);
  });

  it("resumes trapping in the lower dialog once the upper one closes", () => {
    const lower = createContainer("button", "button");
    const lowerButtons = lower.querySelectorAll("button");
    const upper = createContainer("button");

    renderTrap(lower, true, false);
    const { unmount } = renderTrap(upper, true, false);
    unmount();
    act(() => {
      lowerButtons[1].focus();
    });

    act(() => {
      pressTabOn(lowerButtons[1]);
    });
    expect(document.activeElement).toBe(lowerButtons[0]);
  });

  it("leaves Tab alone when its container is no longer in the document", () => {
    // trap 還開著但容器已被移出 document（呼叫端另有條件控制渲染）：不能把整頁的 Tab 吞掉
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const container = createContainer("button");

    renderTrap(container, true, false);
    container.remove();
    act(() => {
      outside.focus();
    });

    let event!: KeyboardEvent;
    act(() => {
      event = pressTabOn(outside);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it("wraps focus when the container stops keydown propagation", () => {
    // 對話框擋掉框內 keydown 往上傳（不讓頁面快捷鍵收到），Tab 從框內的元素送出
    const container = createContainer("button", "button");
    container.addEventListener("keydown", (e) => e.stopPropagation());
    const buttons = container.querySelectorAll("button");

    renderTrap(container, true);
    act(() => {
      buttons[1].focus();
    });

    act(() => {
      pressTabOn(buttons[1]);
    });
    expect(document.activeElement).toBe(buttons[0]);
  });
});
