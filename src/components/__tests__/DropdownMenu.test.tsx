/**
 * DropdownMenu 元件測試：開關、ESC、focus return、arrow key 導航。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { DropdownMenu } from "../DropdownMenu";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function renderMenu() {
  return render(
    <DropdownMenu label="Export" buttonTestId="trigger" menuTestId="menu">
      {(close) => (
        <>
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
          <a
            role="menuitem"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              close();
            }}
          >
            JSON
          </a>
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
          <a
            role="menuitem"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              close();
            }}
          >
            CSV
          </a>
        </>
      )}
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("opens on trigger click and closes on second click", async () => {
    renderMenu();
    const trigger = screen.getByTestId("trigger");

    await userEvent.click(trigger);
    expect(screen.getByTestId("menu")).toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.queryByTestId("menu")).not.toBeInTheDocument();
  });

  it("closes on ESC and returns focus to trigger", async () => {
    renderMenu();
    const trigger = screen.getByTestId("trigger");

    await userEvent.click(trigger);
    expect(screen.getByTestId("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("auto-focuses first menuitem on open", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByText("JSON")).toHaveFocus();
  });

  it("ArrowDown moves focus to next item", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    // 初始 focus 在 JSON
    expect(screen.getByText("JSON")).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByText("CSV")).toHaveFocus();
  });

  it("ArrowDown wraps from last to first", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    await userEvent.keyboard("{ArrowDown}"); // CSV
    await userEvent.keyboard("{ArrowDown}"); // wrap → JSON
    expect(screen.getByText("JSON")).toHaveFocus();
  });

  it("ArrowUp from first wraps to last", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    // 初始 focus 在 JSON (first)
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByText("CSV")).toHaveFocus();
  });

  it("clicking menuitem closes the menu", async () => {
    renderMenu();
    await userEvent.click(screen.getByTestId("trigger"));
    await userEvent.click(screen.getByText("JSON"));
    expect(screen.queryByTestId("menu")).not.toBeInTheDocument();
  });
});
