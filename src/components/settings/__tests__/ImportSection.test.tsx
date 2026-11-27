/**
 * 匯入的每一列與結果：等不到回應的那筆是「不確定」，不是失敗；說明是 app 自己的句子，整句顯示。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ImportSection } from "../ImportSection";
import { translations } from "../../../i18n/translations";
import type { ImportResult, ParsedRepo } from "../../../utils/importHelpers";

const t = translations.en;
const importState = vi.hoisted(() => ({
  parsedRepos: [] as ParsedRepo[],
  result: null as ImportResult | null,
}));

vi.mock("../../../hooks/useImport", () => ({
  useImport: () => ({
    parsedRepos: importState.parsedRepos,
    isImporting: false,
    result: importState.result,
    parseError: null,
    parseFile: vi.fn(),
    parseText: vi.fn(),
    startImport: vi.fn(),
    reset: vi.fn(),
  }),
}));

const repo = (fullName: string, status: ParsedRepo["status"], error?: string): ParsedRepo => {
  const [owner, name] = fullName.split("/");
  return { owner, name, fullName, status, error };
};

describe("ImportSection", () => {
  beforeEach(() => {
    importState.parsedRepos = [];
    importState.result = null;
  });

  it("marks a timed-out repo as unclear, not failed, and shows the whole sentence", () => {
    importState.parsedRepos = [repo("owner/slow", "uncertain", t.discovery.addFailed.timedOut)];
    render(<ImportSection />);

    expect(screen.getByLabelText(t.settings.import.statusUncertain)).toBeInTheDocument();
    expect(screen.queryByLabelText(t.settings.import.statusError)).not.toBeInTheDocument();
    // 在地化的說明可能超過 100 字元（英文的 timedOut 就是）：不截斷
    const note = screen.getByText(t.discovery.addFailed.timedOut);
    expect(note).toHaveClass("import-item-warning");
    expect(note).not.toHaveClass("import-item-error");
  });

  it("counts unclear repos on their own, only when there are any", () => {
    importState.result = { total: 3, success: 1, skipped: 0, failed: 1, uncertain: 1 };
    const { unmount } = render(<ImportSection />);

    const stats = screen.getByRole("status");
    expect(within(stats).getByText(t.settings.import.uncertain)).toBeInTheDocument();
    unmount();

    importState.result = { total: 2, success: 1, skipped: 0, failed: 1, uncertain: 0 };
    render(<ImportSection />);
    expect(
      within(screen.getByRole("status")).queryByText(t.settings.import.uncertain)
    ).not.toBeInTheDocument();
  });
});
