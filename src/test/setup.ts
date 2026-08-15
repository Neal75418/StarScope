import "@testing-library/jest-dom";
import { vi } from "vitest";
import * as React from "react";

// Global i18n mock using actual English translations.
// Individual tests can override with their own vi.mock if needed.
vi.mock("../i18n", async () => {
  const { createI18nMock } = await import("./mockI18n");
  return createI18nMock(vi.fn());
});

// Mock react-window for testing - renders all items without virtualization.
// 必須把 rowProps 展開給 row（真實 react-window 就是這樣傳資料的）：
// 少了它，改用 rowProps 傳資料的列表在測試裡會拿到 undefined，
// 而且會讓「rowComponent 引用穩定性」這類回歸完全測不出來
// （見 RepoListRowStability.test.tsx，那條測試刻意不用這個 mock）。
vi.mock("react-window", () => {
  return {
    List: ({
      rowComponent: RowComponent,
      rowCount,
      rowProps,
    }: {
      rowComponent: React.ComponentType<Record<string, unknown>>;
      rowCount: number;
      rowProps?: Record<string, unknown>;
    }) => {
      return React.createElement(
        "div",
        { "data-testid": "virtual-list" },
        Array.from({ length: rowCount }, (_, index) =>
          React.createElement(RowComponent, {
            key: index,
            ...(rowProps ?? {}),
            index,
            style: {},
            ariaAttributes: {
              "aria-posinset": index + 1,
              "aria-setsize": rowCount,
              role: "listitem",
            },
          })
        )
      );
    },
  };
});

// Mock react-virtualized-auto-sizer for testing - provides fixed dimensions
vi.mock("react-virtualized-auto-sizer", () => ({
  AutoSizer: ({
    renderProp,
  }: {
    renderProp: (size: { height: number; width: number }) => React.ReactNode;
  }) => {
    return renderProp({ height: 600, width: 800 });
  },
}));
