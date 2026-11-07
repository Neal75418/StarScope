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

  it("auto-dismisses after default duration", () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);

    expect(mockOnDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4000);

    expect(mockOnDismiss).toHaveBeenCalledWith("test-1");
  });

  it("auto-dismisses after custom duration", () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} duration={2000} />);

    vi.advanceTimersByTime(2000);

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

  it("renders nothing until a toast is raised", () => {
    render(
      <ToastProvider>
        <Trigger type="success" message="Saved" />
      </ToastProvider>
    );

    expect(document.querySelector(".toast-container")).toBeNull();
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
