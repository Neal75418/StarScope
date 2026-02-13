import "@testing-library/jest-dom";
import { vi } from "vitest";
import * as React from "react";

// Global i18n mock using actual English translations.
// Individual tests can override with their own vi.mock if needed.
vi.mock("../i18n", async () => {
  const { createI18nMock } = await import("./mockI18n");
  return createI18nMock(vi.fn());
});

// Mock react-window for testing - renders all items without virtualization
vi.mock("react-window", () => {
  return {
    List: ({
      rowComponent: RowComponent,
      rowCount,
    }: {
      rowComponent: React.ComponentType<{ index: number; style: object; ariaAttributes: object }>;
      rowCount: number;
    }) => {
      return React.createElement(
        "div",
        { "data-testid": "virtual-list" },
        Array.from({ length: rowCount }, (_, index) =>
          React.createElement(RowComponent, {
            key: index,
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
