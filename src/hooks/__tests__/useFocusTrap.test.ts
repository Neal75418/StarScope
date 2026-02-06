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

    renderHook(() => {
      const ref = useFocusTrap(true);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

    expect(document.activeElement).toBe(firstBtn);
  });

  it("skips auto-focus when autoFocus is false", () => {
    const container = createContainer("button", "input");
    document.body.focus();

    renderHook(() => {
      const ref = useFocusTrap(true, false);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

    expect(document.activeElement).not.toBe(container.querySelector("button"));
  });

  it("wraps focus from last to first on Tab", () => {
    const container = createContainer("button", "button");
    const buttons = container.querySelectorAll("button");

    renderHook(() => {
      const ref = useFocusTrap(true);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

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

    renderHook(() => {
      const ref = useFocusTrap(true);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

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

    renderHook(() => {
      const ref = useFocusTrap(false);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

    expect(document.activeElement).toBe(document.body);
  });

  it("does not trap when non-Tab key is pressed", () => {
    const container = createContainer("button", "button");
    const buttons = container.querySelectorAll("button");

    renderHook(() => {
      const ref = useFocusTrap(true);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

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

  it("does nothing on Tab when no focusable elements exist", () => {
    const container = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "not focusable";
    container.appendChild(span);
    document.body.appendChild(container);

    renderHook(() => {
      const ref = useFocusTrap(true, false);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

    // Should not throw
    act(() => {
      pressTab();
    });
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

    const { unmount } = renderHook(() => {
      const ref = useFocusTrap(true);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

    expect(document.activeElement).toBe(container.querySelector("button"));

    act(() => {
      unmount();
    });
    expect(document.activeElement).toBe(externalBtn);
  });

  it("does not wrap Tab when focus is in the middle", () => {
    const container = createContainer("button", "input", "button");
    const input = container.querySelector("input");

    renderHook(() => {
      const ref = useFocusTrap(true);
      (ref as { current: HTMLDivElement | null }).current = container;
      return ref;
    });

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
});
