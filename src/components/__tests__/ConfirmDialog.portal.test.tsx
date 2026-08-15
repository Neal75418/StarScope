/**
 * 對話框必須跳出被 transform 的祖先。
 *
 * .animated-page 用 `animation: ... both`，結束狀態帶 transform（實測是單位矩陣，
 * 但不是 none）。非 none 的 transform 會讓子孫的 position:fixed 改成相對於它定位，
 * 於是「全螢幕」遮罩變成整份文件那麼高（實測 4346px vs 視窗 720px），對話框被置中在
 * 文件正中央——瀏覽器聚焦時就把頁面捲過去，使用者點第一列卻被丟到清單中段。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfirmDialog } from "../ConfirmDialog";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: { common: { confirm: "確定", cancel: "取消" } } }),
}));

describe("ConfirmDialog 的掛載位置", () => {
  it("renders outside a transformed ancestor", () => {
    const { container } = render(
      <div className="animated-page" style={{ transform: "translateY(0)" }}>
        <ConfirmDialog isOpen title="t" message="m" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </div>
    );

    const dialog = screen.getByRole("alertdialog");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});
