/**
 * Unit tests for CategoryEditModal component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CategoryEditModal } from "../CategoryEditModal";
import type { CategoryTreeNode } from "../../../api/client";

describe("CategoryEditModal", () => {
  const mockCategory: CategoryTreeNode = {
    id: 1,
    name: "Test Category",
    description: "Test description",
    icon: "📁",
    color: "#ff0000",
    sort_order: 0,
    repo_count: 5,
    children: [],
  };

  const defaultProps = {
    category: mockCategory,
    isSubmitting: false,
    onSubmit: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
  };

  it("renders with category data", () => {
    render(<CategoryEditModal {...defaultProps} />);

    expect(screen.getByText("Edit category")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test Category")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test description")).toBeInTheDocument();
    expect(screen.getByDisplayValue("📁")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a press that started inside the dialog ends on the overlay", () => {
    // 拖曳選取名稱時滑出框外才放開：瀏覽器把 click 發給按下與放開兩處的共同祖先，也就是遮罩
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;

    fireEvent.mouseDown(screen.getByDisplayValue("Test Category"));
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on overlay click while submitting", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} isSubmitting={true} />);

    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on ESC key while submitting", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} isSubmitting={true} />);

    await user.click(screen.getByDisplayValue("Test Category"));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when modal content is clicked", async () => {
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders as an overlay dialog on document.body with the shared dialog styles", () => {
    // jsdom 看不到 CSS：這裡只守「用的是有樣式規則的那組 class、而且掛在 body」。
    // 真的蓋住頁面由 e2e/category-management.spec.ts 在瀏覽器裡量
    render(<CategoryEditModal {...defaultProps} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("dialog");
    expect(dialog.parentElement).toHaveClass("dialog-overlay");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it("moves focus to the name field when opened", () => {
    render(<CategoryEditModal {...defaultProps} />);

    expect(screen.getByDisplayValue("Test Category")).toHaveFocus();
  });

  it("returns focus to the element that opened it when closed", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    try {
      const { unmount } = render(<CategoryEditModal {...defaultProps} />);
      expect(trigger).not.toHaveFocus();

      unmount();

      expect(trigger).toHaveFocus();
    } finally {
      trigger.remove();
    }
  });

  it("keeps Tab inside the dialog when focus is on the last button", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Behind the dialog</button>
        <CategoryEditModal {...defaultProps} />
      </>
    );
    screen.getByText("Save").focus();

    await user.tab();

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("submits form with updated data", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);

    const nameInput = screen.getByDisplayValue("Test Category");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          name: "Updated Name",
        })
      );
    });
  });

  it("sends null for the fields it clears so the saved values are removed", async () => {
    // 送 undefined 的話 JSON 裡沒有這個欄位，後端當成沒改：清空後按儲存，舊的說明還在。
    // 顏色是 type="color"，介面上清不掉，這裡不動它
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} />);

    await user.clear(screen.getByDisplayValue("Test description"));
    await user.clear(screen.getByDisplayValue("📁"));
    await user.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(1, {
        description: null,
        icon: null,
      })
    );
  });

  it("leaves out the fields it did not touch, the name included", async () => {
    // 讀分類失敗時框裡是樹上的快取，可能比伺服器舊：沒動的欄位送出去，會把伺服器上較新的值蓋掉或清掉。
    // 名稱也一樣：別處剛改好的名字會被改回快取裡的舊名
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} />);

    await user.click(screen.getByText("Save"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(1, {}));
  });

  it("sends the fields it changed, trimmed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} />);

    const description = screen.getByDisplayValue("Test description");
    await user.clear(description);
    await user.type(description, "  New description  ");
    const icon = screen.getByDisplayValue("📁");
    await user.clear(icon);
    await user.type(icon, " ⭐");
    await user.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(1, {
        description: "New description",
        icon: "⭐",
      })
    );
  });

  it("sends a color it changed", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} />);
    // 取色器沒有可以打字的地方：直接觸發 input，等同使用者選了新顏色
    fireEvent.input(screen.getByDisplayValue("#ff0000"), { target: { value: "#00ff00" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(1, { color: "#00ff00" }));
  });

  describe("clearing the color", () => {
    const withoutColor: CategoryTreeNode = { ...mockCategory, color: null };

    it("offers to clear a color that is set", () => {
      render(<CategoryEditModal {...defaultProps} />);

      expect(screen.getByRole("button", { name: "Clear color" })).toBeInTheDocument();
      expect(screen.queryByText("Not set")).not.toBeInTheDocument();
    });

    it("says a category without a color has none, instead of showing it as black", () => {
      render(<CategoryEditModal {...defaultProps} category={withoutColor} />);

      expect(screen.queryByRole("button", { name: "Clear color" })).not.toBeInTheDocument();
      // 名稱就帶著「未設定」：報讀軟體先唸名稱，不會先聽到取色器的值 #000000
      expect(screen.getByLabelText("Color")).toHaveAccessibleName("Color Not set");
      // 色塊畫成空的靠這個 class（jsdom 看不到 CSS，只守得到 class 這一層）
      expect(screen.getByLabelText("Color")).toHaveClass("category-color-unset");
    });

    it("clears the color, keeps focus on the picker, and saves it as removed", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(true);
      render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} />);

      await user.click(screen.getByRole("button", { name: "Clear color" }));

      // 清除鈕會消失：焦點不移的話，鍵盤使用者會掉到 body
      expect(screen.getByLabelText("Color")).toHaveFocus();
      expect(screen.getByLabelText("Color")).toHaveAccessibleName("Color Not set");
      expect(screen.getByLabelText("Color")).toHaveClass("category-color-unset");
      expect(screen.queryByRole("button", { name: "Clear color" })).not.toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();

      await user.click(screen.getByText("Save"));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(1, { color: null }));
    });

    it("sets the color again when one is picked after clearing", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(true);
      render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} />);

      await user.click(screen.getByRole("button", { name: "Clear color" }));
      fireEvent.input(screen.getByLabelText("Color"), { target: { value: "#00ff00" } });

      expect(screen.getByRole("button", { name: "Clear color" })).toBeInTheDocument();
      expect(screen.getByLabelText("Color")).toHaveAccessibleName("Color");
      expect(screen.getByLabelText("Color")).not.toHaveClass("category-color-unset");
      await user.click(screen.getByText("Save"));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(1, { color: "#00ff00" }));
    });

    it("sends nothing when a color is set and cleared again on a category without one", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(true);
      render(<CategoryEditModal {...defaultProps} category={withoutColor} onSubmit={onSubmit} />);

      fireEvent.input(screen.getByLabelText("Color"), { target: { value: "#00ff00" } });
      await user.click(screen.getByRole("button", { name: "Clear color" }));
      await user.click(screen.getByText("Save"));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(1, {}));
    });
  });

  it("calls onClose after successful submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("does not close after failed submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows submitting state", () => {
    render(<CategoryEditModal {...defaultProps} isSubmitting={true} />);

    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(screen.getByText("Saving...")).toBeDisabled();
  });

  it("handles empty description gracefully", async () => {
    const user = userEvent.setup();
    const categoryWithoutDesc: CategoryTreeNode = {
      ...mockCategory,
      description: null,
      icon: null,
      color: null,
    };
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <CategoryEditModal {...defaultProps} category={categoryWithoutDesc} onSubmit={onSubmit} />
    );

    await user.click(screen.getByText("Save"));

    // 沒有顏色的分類，顏色欄畫成 #000000；沒動的話不送，不會被存成黑色
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(1, {});
    });
  });

  it("calls onClose on ESC key while focus is in the name field", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CategoryEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByDisplayValue("Test Category"));
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
