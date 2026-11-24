import type { Dispatch, SetStateAction } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  createAlertRule: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  checkAlerts: vi.fn(),
  acknowledgeAllTriggeredAlerts: vi.fn(),
}));

vi.mock("../../utils/error", () => ({
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

import {
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  checkAlerts,
  acknowledgeAllTriggeredAlerts,
} from "../../api/client";
import { useAlertRuleOperations } from "../useAlertRuleOperations";
import type { Toast } from "../types";
import type { AlertRule } from "../../api/types";
import { ApiError } from "../../api/types";
import { translations } from "../../i18n/translations";

const mockCreateAlertRule = vi.mocked(createAlertRule);
const mockUpdateAlertRule = vi.mocked(updateAlertRule);
const mockDeleteAlertRule = vi.mocked(deleteAlertRule);
const mockCheckAlerts = vi.mocked(checkAlerts);
const mockAcknowledgeAll = vi.mocked(acknowledgeAllTriggeredAlerts);

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    name: "Test Rule",
    signal_type: "stars_velocity",
    operator: "gt",
    threshold: 100,
    enabled: true,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...overrides,
  } as AlertRule;
}

describe("useAlertRuleOperations", () => {
  let mockToast: Toast;
  let mockLoadRules: () => Promise<void>;
  let rules: AlertRule[];
  let setRules: Dispatch<SetStateAction<AlertRule[]>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
    mockLoadRules = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    rules = [makeRule({ id: 1, enabled: true }), makeRule({ id: 2, enabled: false })];
    setRules = vi.fn<Dispatch<SetStateAction<AlertRule[]>>>((updater) => {
      if (typeof updater === "function") {
        rules = (updater as (prev: AlertRule[]) => AlertRule[])(rules);
      }
    });
  });

  function renderOps() {
    return renderHook(() =>
      useAlertRuleOperations({
        rules,
        setRules,
        loadRules: mockLoadRules,
        toast: mockToast,
      })
    );
  }

  it("handleCreate calls createAlertRule and reloads", async () => {
    mockCreateAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.handleCreate({
        name: "New",
        signal_type: "stars",
        operator: "gt",
        threshold: 50,
      } as never);
    });

    expect(success).toBe(true);
    expect(mockCreateAlertRule).toHaveBeenCalled();
    expect(mockLoadRules).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("handleUpdate calls updateAlertRule and reloads", async () => {
    mockUpdateAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.handleUpdate(1, {
        name: "Updated",
        signal_type: "stars",
        operator: "gt",
        threshold: 200,
      } as never);
    });

    expect(success).toBe(true);
    expect(mockUpdateAlertRule).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: "Updated" })
    );
    expect(mockLoadRules).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/^Alert rule updated$/));
  });

  describe("handleUpdate sends the fields the form emptied as null", () => {
    // 送 undefined 的話 JSON 裡沒有這個欄位，後端當成沒改：規則還是只看原本那個儲存庫、舊的說明還在
    const base = { name: "Rule", signal_type: "stars", operator: ">" as const, threshold: 200 };

    it("sends repo_id null for a rule that now applies to all repos", async () => {
      mockUpdateAlertRule.mockResolvedValue(undefined as never);
      const { result } = renderOps();

      await act(async () => {
        await result.current.handleUpdate(1, { ...base });
      });

      expect(mockUpdateAlertRule).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ repo_id: null })
      );
    });

    it("sends description null for a description that was cleared", async () => {
      mockUpdateAlertRule.mockResolvedValue(undefined as never);
      const { result } = renderOps();

      await act(async () => {
        await result.current.handleUpdate(1, { ...base });
      });

      expect(mockUpdateAlertRule).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ description: null })
      );
    });

    it("keeps the repo and the description that are set", async () => {
      mockUpdateAlertRule.mockResolvedValue(undefined as never);
      const { result } = renderOps();

      await act(async () => {
        await result.current.handleUpdate(1, { ...base, repo_id: 3, description: "watch it" });
      });

      expect(mockUpdateAlertRule).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ repo_id: 3, description: "watch it" })
      );
    });
  });

  describe("the copy for a rule that is no longer in the list", () => {
    // 測試的全域 i18n 一律是英文：中文文案要直接讀翻譯表才守得到
    it.each(["en", "zh-TW"] as const)(
      "%s says what did not happen and where the rule can come back",
      (lang) => {
        const t = translations[lang];
        const copy = t.settings.alerts.toast;
        const [notSaved, notChanged, notInList, mayBeDeleted] =
          lang === "en"
            ? [
                "Not saved",
                "Not changed",
                "This alert rule is no longer in the list",
                "may have been deleted",
              ]
            : ["沒有儲存", "沒有切換", "這條警報規則已經不在清單上", "可能已被刪除"];

        expect(copy.goneNotSaved.startsWith(notSaved)).toBe(true);
        expect(copy.goneNotSwitched.startsWith(notChanged)).toBe(true);
        // 規則可能只是藏起來：刪除時不能說成已經刪掉
        expect(/已刪除|was deleted/.test(copy.goneOnDelete)).toBe(false);
        expect(copy.goneOnDelete.startsWith(notInList)).toBe(true);
        // 「會回來」只對取消追蹤成立（重設資料、永久刪除後不會回來）：指到已封存裡真的有的按鈕
        for (const text of [copy.goneNotSaved, copy.goneNotSwitched, copy.goneOnDelete]) {
          expect(text).toContain(t.settings.archived.title);
          expect(text).toContain(t.settings.archived.restar);
          // 三種來源裡兩種是真的刪了：每句都要先講可能已被刪除，不能說成一律會回來
          expect(text).toContain(mayBeDeleted);
        }
      }
    );
  });

  describe("a rule that is no longer in the list", () => {
    // 刪了，或它看的儲存庫已不在追蹤清單（封存視同刪除，後端回一樣的 code）：兩種分不出來，不能說成已經刪除，
    // 只能說這次沒有生效、規則可能會回來；結束這次操作並重讀，不顯示後端的英文原字
    const gone = () => new ApiError(404, "Rule not found", "ALERT_RULE_NOT_FOUND");
    const base = { name: "Rule", signal_type: "stars", operator: ">" as const, threshold: 200 };

    it("closes the edit form and says the changes were not saved", async () => {
      mockUpdateAlertRule.mockRejectedValue(gone());
      const { result } = renderOps();

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.handleUpdate(1, { ...base });
      });

      expect(success).toBe(true);
      expect(mockToast.warning).toHaveBeenCalledWith(expect.stringMatching(/^Not saved/));
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockLoadRules).toHaveBeenCalled();
    });

    it("still fails the save when the repo picked in the form is the one that is gone", async () => {
      // 同樣是 404，但不帶規則不在的 code：規則還在，存檔是真的沒成功
      mockUpdateAlertRule.mockRejectedValue(new ApiError(404, "Repo not found: 9"));
      const { result } = renderOps();

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.handleUpdate(1, { ...base, repo_id: 9 });
      });

      expect(success).toBe(false);
      expect(mockToast.error).toHaveBeenCalled();
      expect(mockToast.warning).not.toHaveBeenCalled();
    });

    it("closes the delete prompt without claiming the rule was deleted", async () => {
      mockDeleteAlertRule.mockRejectedValue(gone());
      const { result } = renderOps();

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.handleDelete(1);
      });

      expect(success).toBe(true);
      expect(mockToast.info).toHaveBeenCalledWith(
        expect.stringMatching(/^This alert rule is no longer in the list/)
      );
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockLoadRules).toHaveBeenCalled();
    });

    it("says the switch did not change and reloads", async () => {
      mockUpdateAlertRule.mockRejectedValue(gone());
      const { result } = renderOps();

      await act(async () => {
        await result.current.handleToggle(1);
      });

      expect(mockToast.warning).toHaveBeenCalledWith(expect.stringMatching(/^Not changed/));
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockLoadRules).toHaveBeenCalled();
    });
  });

  it("handleDelete calls deleteAlertRule and reloads", async () => {
    mockDeleteAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleDelete(1);
    });

    expect(mockDeleteAlertRule).toHaveBeenCalledWith(1);
    expect(mockLoadRules).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/^Alert rule deleted$/));
  });

  it("handleToggle optimistically updates then calls API", async () => {
    mockUpdateAlertRule.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleToggle(1);
    });

    // Optimistic update: setRules called with toggled enabled
    expect(setRules).toHaveBeenCalled();
    expect(mockUpdateAlertRule).toHaveBeenCalledWith(1, { enabled: false });
  });

  it("handleToggle reverts on API failure", async () => {
    mockUpdateAlertRule.mockRejectedValue(new Error("API error"));

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleToggle(1);
    });

    // setRules called twice: optimistic + revert
    expect(setRules).toHaveBeenCalledTimes(2);
    // 只數呼叫次數守不住 revert 寫錯值——驗最終狀態真的還原為 enabled: true
    expect(rules.find((r) => r.id === 1)?.enabled).toBe(true);
    expect(rules.find((r) => r.id === 2)?.enabled).toBe(false); // 其他規則不受影響
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("handleToggle does nothing for non-existent rule", async () => {
    const { result } = renderOps();

    await act(async () => {
      await result.current.handleToggle(999);
    });

    expect(mockUpdateAlertRule).not.toHaveBeenCalled();
  });

  it("handleCheckNow calls checkAlerts", async () => {
    mockCheckAlerts.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleCheckNow();
    });

    expect(mockCheckAlerts).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("handleAcknowledgeAll calls acknowledgeAllTriggeredAlerts", async () => {
    mockAcknowledgeAll.mockResolvedValue(undefined as never);

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleAcknowledgeAll();
    });

    expect(mockAcknowledgeAll).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });
});
