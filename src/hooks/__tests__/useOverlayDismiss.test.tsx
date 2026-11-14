/**
 * useOverlayDismiss 的單元測試
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useOverlayDismiss } from "../useOverlayDismiss";

/** 遮罩裡放一顆不擋 click 往上傳的按鈕：hook 自己要分得出 click 是不是發給遮罩 */
function Overlay({ onDismiss, enabled }: { onDismiss: () => void; enabled?: boolean }) {
  const overlayDismiss = useOverlayDismiss(onDismiss, enabled);
  return (
    <div data-testid="overlay" {...overlayDismiss}>
      <button>Inside</button>
    </div>
  );
}

describe("useOverlayDismiss", () => {
  it("dismisses when the press, the release and the click all land on the overlay", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores a click on the overlay when the press started on a child", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);

    fireEvent.mouseDown(screen.getByText("Inside"));
    fireEvent.mouseUp(screen.getByTestId("overlay"));
    fireEvent.click(screen.getByTestId("overlay"));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ignores a click on the overlay when the press started there but was released on a child", () => {
    // 在遮罩按下、拖進框內才放開：瀏覽器一樣把 click 發給共同祖先（遮罩）
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(screen.getByText("Inside"));
    fireEvent.click(overlay);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ignores a click on the overlay that was not preceded by a release on it", () => {
    // 按下之後要在遮罩上放開才算數：只有按下就來的 click 不關
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ignores a click coming from a child after a press and release on the overlay", () => {
    // 遮罩上的按下放開不保證會跟著一個 click；之後用鍵盤按框內的按鈕，那次 click 不能算在遮罩頭上
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.click(screen.getByText("Inside"));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("needs a fresh press for every dismissal", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);
    fireEvent.click(overlay);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} enabled={false} />);
    const overlay = screen.getByTestId("overlay");

    fireEvent.mouseDown(overlay);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
