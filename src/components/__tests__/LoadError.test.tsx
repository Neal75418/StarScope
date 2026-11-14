/**
 * LoadError 的單元測試
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoadError } from "../LoadError";

function renderLoadError(props: Partial<React.ComponentProps<typeof LoadError>> = {}) {
  const onRetry = vi.fn();
  const ui = (overrides: Partial<React.ComponentProps<typeof LoadError>> = {}) => (
    <LoadError
      className="settings-error"
      message="Couldn't load the list."
      isRetrying={false}
      onRetry={onRetry}
      {...props}
      {...overrides}
    />
  );
  const view = render(ui());
  return {
    ...view,
    onRetry,
    rerenderWith: (overrides: Parameters<typeof ui>[0]) => view.rerender(ui(overrides)),
  };
}

describe("LoadError", () => {
  it("announces the message and offers a retry", () => {
    const { onRetry } = renderLoadError();

    // 只播報說明那句，重試鈕不算在訊息裡
    expect(screen.getByRole("alert")).toHaveTextContent(/^Couldn't load the list\.$/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("carries the class and test id of the place it is used in", () => {
    renderLoadError({ className: "notification-load-error", testId: "probe" });

    expect(screen.getByTestId("probe")).toHaveClass("notification-load-error");
  });

  it("says a retry is running and ignores further presses until it settles", () => {
    const { onRetry } = renderLoadError({ isRetrying: true });
    const button = screen.getByRole("button", { name: "Retrying…" });

    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("keeps the same button, and keyboard focus on it, while the retry runs", () => {
    // 換成 disabled 或把按鈕拿掉的話，焦點會離開它（掉到 body）
    const { rerenderWith } = renderLoadError();
    const button = screen.getByRole("button", { name: "Retry" });
    button.focus();

    rerenderWith({ isRetrying: true });

    expect(screen.getByRole("button", { name: "Retrying…" })).toBe(button);
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
  });
});
