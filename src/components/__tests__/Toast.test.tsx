/**
 * Unit tests for Toast components
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { Toast, ToastProvider, useToast, type ToastMessage } from "../Toast";

describe("Toast", () => {
  const mockToast: ToastMessage = {
    id: "test-1",
    type: "success",
    message: "Operation successful",
  };

  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders toast message", () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);

    expect(screen.getByText("Operation successful")).toBeInTheDocument();
  });

  it("shows success icon", () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);

    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("shows error icon", () => {
    render(<Toast toast={{ ...mockToast, type: "error" }} onDismiss={mockOnDismiss} />);

    expect(screen.getByText("✗")).toBeInTheDocument();
  });

  it("shows info icon", () => {
    render(<Toast toast={{ ...mockToast, type: "info" }} onDismiss={mockOnDismiss} />);

    expect(screen.getByText("ℹ")).toBeInTheDocument();
  });

  it("shows warning icon", () => {
    render(<Toast toast={{ ...mockToast, type: "warning" }} onDismiss={mockOnDismiss} />);

    expect(screen.getByText("⚠")).toBeInTheDocument();
  });

  it("calls onDismiss when close button clicked", () => {
    vi.useFakeTimers();
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);

    const closeButton = screen.getByRole("button");
    fireEvent.click(closeButton);

    expect(mockOnDismiss).toHaveBeenCalledWith("test-1");
    vi.useRealTimers();
  });

  it.each([
    ["success", 4000],
    ["info", 4000],
    ["warning", 10_000],
    ["error", 10_000],
  ] as const)("dismisses a %s toast by itself after %i ms", (type, duration) => {
    // 錯誤與警告留得比成功久：內容較長，也常在使用者沒盯著畫面時跳出來
    render(<Toast toast={{ ...mockToast, type }} onDismiss={mockOnDismiss} />);

    vi.advanceTimersByTime(duration - 1);
    expect(mockOnDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockOnDismiss).toHaveBeenCalledWith("test-1");
  });

  it("does not count down while paused, and starts over once released", () => {
    const { rerender } = render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);
    vi.advanceTimersByTime(3000);

    rerender(<Toast toast={mockToast} onDismiss={mockOnDismiss} paused />);
    vi.advanceTimersByTime(60_000);
    expect(mockOnDismiss).not.toHaveBeenCalled();

    // 放開後重新計時，不是把暫停前剩下的 1000 ms 跑完
    rerender(<Toast toast={mockToast} onDismiss={mockOnDismiss} paused={false} />);
    vi.advanceTimersByTime(3999);
    expect(mockOnDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mockOnDismiss).toHaveBeenCalledWith("test-1");
  });

  it("applies correct CSS class for toast type", () => {
    const { container } = render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);

    expect(container.querySelector(".toast-success")).toBeInTheDocument();
  });
});

describe("ToastProvider", () => {
  function Trigger({ type, message }: { type: ToastMessage["type"]; message: string }) {
    const toast = useToast();
    return <button onClick={() => toast[type](message)}>{`raise ${message}`}</button>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an empty live region mounted before any toast is raised", () => {
    // live region 要先空著存在，之後插進來的內容才會被報讀；和第一則 toast 一起掛上的話那一則可能不會被唸出來
    render(
      <ToastProvider>
        <Trigger type="success" message="Saved" />
      </ToastProvider>
    );

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    fireEvent.click(screen.getByText("raise Saved"));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Saved");
  });

  it("marks the live region as not atomic", () => {
    // role="status" 預設 aria-atomic 是 true：容器裡同時有好幾則時，每加一則整塊都會被重唸
    render(<ToastProvider>{null}</ToastProvider>);

    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "false");
  });

  it("an error outlives a success raised at the same time", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="Saved" />
        <Trigger type="error" message="Add failed" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise Saved"));
    fireEvent.click(screen.getByText("raise Add failed"));

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Add failed");

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("holds every toast while the pointer is over the stack", () => {
    // 還在讀其中一則時，旁邊的不能自己消失讓整疊跳動
    render(
      <ToastProvider>
        <Trigger type="success" message="Saved" />
        <Trigger type="error" message="Add failed" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise Saved"));
    fireEvent.click(screen.getByText("raise Add failed"));
    const stack = screen.getByRole("status");

    fireEvent.mouseOver(screen.getByText("Add failed"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Add failed")).toBeInTheDocument();

    fireEvent.mouseLeave(stack);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByText("Add failed")).toBeInTheDocument();
  });

  it("holds a toast that is raised while the stack is already held", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="First" />
        <Trigger type="success" message="Second" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise First"));
    fireEvent.mouseOver(screen.getByText("First"));

    fireEvent.click(screen.getByText("raise Second"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("holds every toast while keyboard focus is inside the stack", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="Saved" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise Saved"));
    const dismiss = screen.getByRole("button", { name: /dismiss|關閉/i });

    act(() => {
      dismiss.focus();
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => {
      dismiss.blur();
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("keeps holding when the pointer leaves but focus is still inside", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="Saved" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise Saved"));
    const stack = screen.getByRole("status");

    fireEvent.mouseOver(screen.getByText("Saved"));
    act(() => {
      screen.getByRole("button", { name: /dismiss|關閉/i }).focus();
    });
    fireEvent.mouseLeave(stack);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("resumes counting after the focused toast is dismissed", () => {
    // 焦點所在的那則被關掉時元素直接從 DOM 消失，不會有 blur 事件；「焦點在裡面」不能就此卡住
    render(
      <ToastProvider>
        <Trigger type="success" message="First" />
        <Trigger type="success" message="Second" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise First"));
    const dismiss = screen.getByRole("button", { name: /dismiss|關閉/i });
    act(() => {
      dismiss.focus();
    });
    fireEvent.click(dismiss);
    expect(screen.queryByText("First")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("raise Second"));
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("Second")).not.toBeInTheDocument();
  });

  it("resumes the remaining toasts when the focused one is dismissed", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="First" />
        <Trigger type="success" message="Second" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise First"));
    fireEvent.click(screen.getByText("raise Second"));
    const dismissFirst = screen.getAllByRole("button", { name: /dismiss|關閉/i })[0];
    act(() => {
      dismissFirst.focus();
    });
    fireEvent.click(dismissFirst);

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("Second")).not.toBeInTheDocument();
  });

  it("resumes counting after the hovered stack empties", () => {
    // 滑鼠停在最後一則上按關閉：容器縮成空的，瀏覽器不保證會送 mouseleave
    render(
      <ToastProvider>
        <Trigger type="success" message="First" />
        <Trigger type="success" message="Second" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise First"));
    fireEvent.mouseOver(screen.getByText("First"));
    fireEvent.click(screen.getByRole("button", { name: /dismiss|關閉/i }));

    fireEvent.click(screen.getByText("raise Second"));
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("Second")).not.toBeInTheDocument();
  });

  it("resumes the remaining toasts when the hovered one is dismissed", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="First" />
        <Trigger type="success" message="Second" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise First"));
    fireEvent.click(screen.getByText("raise Second"));
    fireEvent.mouseOver(screen.getByText("First"));
    fireEvent.click(screen.getAllByRole("button", { name: /dismiss|關閉/i })[0]);

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("Second")).not.toBeInTheDocument();
  });

  it("replaces a repeated failure with a fresh toast instead of stacking copies", () => {
    // 後端斷線時連按會疊出一排一樣的錯誤；只留一則，但要是新的節點（重新滑入、重新報讀），
    // 沿用舊的那則的話，重試又失敗就跟按鈕沒反應分不出來
    render(
      <ToastProvider>
        <Trigger type="error" message="Add failed" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise Add failed"));
    const first = screen.getByRole("alert");

    fireEvent.click(screen.getByText("raise Add failed"));

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toBe(first);
  });

  it("gives the replacement its own full duration", () => {
    render(
      <ToastProvider>
        <Trigger type="error" message="Add failed" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise Add failed"));
    act(() => {
      vi.advanceTimersByTime(9000);
    });

    fireEvent.click(screen.getByText("raise Add failed"));
    act(() => {
      vi.advanceTimersByTime(9999);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps toasts of the same type with different messages side by side", () => {
    render(
      <ToastProvider>
        <Trigger type="error" message="Add failed" />
        <Trigger type="error" message="Remove failed" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText("raise Add failed"));
    fireEvent.click(screen.getByText("raise Remove failed"));

    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("keeps toasts with the same message but different types side by side", () => {
    render(
      <ToastProvider>
        <Trigger type="warning" message="Sync incomplete" />
        <Trigger type="info" message="Sync incomplete" />
      </ToastProvider>
    );

    fireEvent.click(screen.getAllByText("raise Sync incomplete")[0]);
    fireEvent.click(screen.getAllByText("raise Sync incomplete")[1]);

    expect(document.querySelectorAll(".toast")).toHaveLength(2);
  });

  describe("while the window is not visible", () => {
    function setWindowHidden(hidden: boolean) {
      Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }

    afterEach(() => {
      // 還原成 jsdom 原型上的 getter
      delete (document as { hidden?: boolean }).hidden;
    });

    it("holds every toast until the window is visible again, then starts over", () => {
      // 最小化或被蓋住時計時器照跑（系統匣的 Refresh All 也不會把視窗叫出來）：回來時訊息不能已經消失
      render(
        <ToastProvider>
          <Trigger type="error" message="Refresh failed" />
        </ToastProvider>
      );
      fireEvent.click(screen.getByText("raise Refresh failed"));
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      setWindowHidden(true);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();

      setWindowHidden(false);
      act(() => {
        vi.advanceTimersByTime(9999);
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("holds a toast raised while the window was already hidden when the app started", () => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      render(
        <ToastProvider>
          <Trigger type="success" message="Saved" />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText("raise Saved"));
      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("stops listening for visibility changes once unmounted", () => {
      const removed = vi.spyOn(document, "removeEventListener");
      const { unmount } = render(<ToastProvider>{null}</ToastProvider>);

      unmount();

      expect(removed).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      removed.mockRestore();
    });
  });

  it("shows a toast raised by a component anywhere under the provider", () => {
    render(
      <ToastProvider>
        <section>
          <Trigger type="error" message="Add failed" />
        </section>
      </ToastProvider>
    );

    fireEvent.click(screen.getByText("raise Add failed"));

    expect(screen.getByRole("alert")).toHaveTextContent("Add failed");
  });

  it("collects toasts from different components into one container", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="From page" />
        <Trigger type="warning" message="From toolbar" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText("raise From page"));
    fireEvent.click(screen.getByText("raise From toolbar"));

    const containers = document.querySelectorAll(".toast-container");
    expect(containers).toHaveLength(1);
    expect(containers[0]).toHaveTextContent("From page");
    expect(containers[0]).toHaveTextContent("From toolbar");
  });

  it("removes a toast when its dismiss button is clicked", () => {
    render(
      <ToastProvider>
        <Trigger type="info" message="Heads up" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("raise Heads up"));

    fireEvent.click(screen.getByRole("button", { name: /dismiss|關閉/i }));

    expect(screen.queryByText("Heads up")).not.toBeInTheDocument();
  });

  it("a later toast does not restart the timer of an earlier one", () => {
    // 容器常駐 App 層、每跳一個 toast 都重新渲染：關閉函式的引用一變，前面的 toast 就會重新計時
    render(
      <ToastProvider>
        <Trigger type="info" message="First" />
        <Trigger type="info" message="Second" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText("raise First"));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(screen.getByText("raise Second"));
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("useToast outside a ToastProvider throws instead of dropping the message", () => {
    // 沒有容器時 toast 不會出現在任何地方：拋錯讓漏包 Provider 在開發與測試時就壞掉
    const silenceReactErrorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useToast())).toThrow(/ToastProvider/);
    } finally {
      silenceReactErrorLog.mockRestore();
    }
  });
});
