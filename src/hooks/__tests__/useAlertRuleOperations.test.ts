import type { Dispatch, SetStateAction } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

vi.mock("../../api/client", () => ({
  createAlertRule: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  checkAlerts: vi.fn(),
}));

import { createAlertRule, updateAlertRule, deleteAlertRule, checkAlerts } from "../../api/client";
import { useAlertRuleOperations } from "../useAlertRuleOperations";
import type { Toast } from "../types";
import type { AlertRule } from "../../api/types";
import { ApiError } from "../../api/types";
import { interpolate } from "../../i18n";
import { translations } from "../../i18n/translations";
import { createTestQueryClient, queryKeys } from "../../lib/react-query";
import {
  API_ERROR_MESSAGES,
  BATCH_ADD_FOLLOWUP_INTERVAL_MS,
  BATCH_ADD_TIMEOUT_MS,
} from "../../constants/api";

const mockCreateAlertRule = vi.mocked(createAlertRule);
const mockUpdateAlertRule = vi.mocked(updateAlertRule);
const mockDeleteAlertRule = vi.mocked(deleteAlertRule);
const mockCheckAlerts = vi.mocked(checkAlerts);

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

  let client: QueryClient;

  /** 鈴鐺與儀表板的已觸發警報（見 invalidateTriggeredAlerts）：寫入之後是不是標成要重讀 */
  const triggeredReadAgain = () =>
    [queryKeys.notifications.polling(), queryKeys.alerts.triggered()].map(
      (key) => client.getQueryState(key)?.isInvalidated
    );

  /** 已觸發警報重讀了幾次（看 Dashboard 那份；兩份一起重讀，見 invalidateTriggeredAlerts） */
  function countTriggeredReads() {
    const spy = vi.spyOn(client, "invalidateQueries");
    return () =>
      spy.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.alerts.triggered())
      ).length;
  }

  function renderOps() {
    // 不回收沒人看的查詢：下面先放進去的兩份已觸發警報要留到斷言的時候
    client = createTestQueryClient();
    client.setDefaultOptions({
      queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
    });
    client.setQueryData(queryKeys.notifications.polling(), []);
    client.setQueryData(queryKeys.alerts.triggered(), []);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    return renderHook(
      () =>
        useAlertRuleOperations({
          rules,
          setRules,
          loadRules: mockLoadRules,
          toast: mockToast,
        }),
      { wrapper }
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
    expect(mockToast.success).toHaveBeenCalledWith(translations.en.settings.alerts.toast.created);
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

  describe("a write that fails", () => {
    // frontend.md 的寫入失敗規則：依原因說明、逾時用警告（伺服器可能已經做完）、任何失敗後都重讀、
    // 逾時後定期重讀一陣子，後端的英文原字不上畫面
    const en = translations.en;
    const failed = en.settings.alerts.failed;
    const withCause = (outcome: string, cause: string) =>
      en.failure.withCause.replace("{outcome}", outcome).replace("{cause}", cause);
    const serverError = () => new ApiError(500, "boom internal");
    const timedOut = () => new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT);
    const base = { name: "Rule", signal_type: "stars", operator: ">" as const, threshold: 200 };
    type Ops = ReturnType<typeof renderOps>["result"]["current"];
    const writes = [
      [
        "create",
        (ops: Ops) => ops.handleCreate({ ...base }),
        () => mockCreateAlertRule,
        failed.create,
      ],
      [
        "update",
        (ops: Ops) => ops.handleUpdate(1, { ...base }),
        () => mockUpdateAlertRule,
        failed.update,
      ],
      ["delete", (ops: Ops) => ops.handleDelete(1), () => mockDeleteAlertRule, failed.delete],
    ] as const;

    it.each(writes)(
      "%s says it was not done and why, and reloads once",
      async (_, run, mock, copy) => {
        mock().mockRejectedValue(serverError());
        const { result } = renderOps();

        let success: boolean | undefined;
        await act(async () => {
          success = await run(result.current);
        });

        expect(success).toBe(false);
        expect(mockToast.error).toHaveBeenCalledWith(withCause(copy.notDone, en.failure.retry));
        // 只有這一則：失敗只說一次
        expect(mockToast.error).toHaveBeenCalledTimes(1);
        expect(mockToast.success).not.toHaveBeenCalled();
        expect(mockToast.warning).not.toHaveBeenCalled();
        expect(mockLoadRules).toHaveBeenCalledTimes(1);
      }
    );

    it.each(writes)(
      "%s says it is unclear and keeps reloading for a while after a timeout",
      async (_, run, mock, copy) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          mock().mockRejectedValue(timedOut());
          const { result } = renderOps();

          let success: boolean | undefined;
          await act(async () => {
            success = await run(result.current);
          });

          expect(success).toBe(false);
          expect(mockToast.warning).toHaveBeenCalledWith(copy.timedOut);
          expect(mockToast.error).not.toHaveBeenCalled();
          expect(mockToast.success).not.toHaveBeenCalled();
          expect(mockLoadRules).toHaveBeenCalledTimes(1);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
          });
          expect(mockLoadRules).toHaveBeenCalledTimes(2);
          // 有期限：不會一直讀下去
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
          });
          const afterWindow = vi.mocked(mockLoadRules).mock.calls.length;
          await act(async () => {
            await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
          });
          expect(mockLoadRules).toHaveBeenCalledTimes(afterWindow);
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it.each([writes[0], writes[1]])(
      "%s says the repository picked is no longer tracked",
      async (_, run, mock, copy) => {
        // 不帶 code 的 404 只會是選的儲存庫不在（規則不在另有 code）：重試沒有用，要改選
        mock().mockRejectedValue(new ApiError(404, "Repo not found: 9"));
        const { result } = renderOps();

        await act(async () => {
          await run(result.current);
        });

        expect(mockToast.error).toHaveBeenCalledWith(copy.repoGone);
        // 只有這一則：失敗只說一次
        expect(mockToast.error).toHaveBeenCalledTimes(1);
        expect(mockToast.success).not.toHaveBeenCalled();
        expect(mockLoadRules).toHaveBeenCalledTimes(1);
      }
    );

    it("names the cause it knows, such as the data engine being unreachable", async () => {
      mockCreateAlertRule.mockRejectedValue(
        new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: connection refused`)
      );
      const { result } = renderOps();

      await act(async () => {
        await result.current.handleCreate({ ...base });
      });

      expect(mockToast.error).toHaveBeenCalledWith(
        withCause(failed.create.notDone, en.failure.engineUnreachable)
      );
      // 只有這一則：失敗只說一次
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it("says switching was not done and why, puts the switch back, and reloads", async () => {
      mockUpdateAlertRule.mockRejectedValue(serverError());
      const { result } = renderOps();

      await act(async () => {
        await result.current.handleToggle(1);
      });

      expect(rules.find((r) => r.id === 1)?.enabled).toBe(true);
      expect(mockToast.error).toHaveBeenCalledWith(
        withCause(failed.toggle.notDone, en.failure.retry)
      );
      // 只有這一則：失敗只說一次
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockLoadRules).toHaveBeenCalledTimes(1);
    });

    it("says switching is unclear and keeps reloading for a while after a timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockUpdateAlertRule.mockRejectedValue(timedOut());
        const { result } = renderOps();

        await act(async () => {
          await result.current.handleToggle(1);
        });

        expect(mockToast.warning).toHaveBeenCalledWith(failed.toggle.timedOut);
        expect(mockToast.error).not.toHaveBeenCalled();
        expect(mockToast.success).not.toHaveBeenCalled();
        expect(mockLoadRules).toHaveBeenCalledTimes(1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
        });
        expect(mockLoadRules).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each(["en", "zh-TW"] as const)("%s copy says what happened", (lang) => {
      // 測試的全域 i18n 一律是英文：中文文案要直接讀翻譯表才守得到
      const copy = translations[lang].settings.alerts.failed;
      const [unclear, listUpdates, notTracked] =
        lang === "en"
          ? ["unclear", "will update on its own", "no longer tracked"]
          : ["不確定", "會自己更新", "已不在追蹤清單"];
      for (const op of [copy.create, copy.update, copy.delete, copy.toggle]) {
        expect(op.timedOut).toContain(unclear);
        expect(op.timedOut).toContain(listUpdates);
        expect(op.notDone).not.toContain(unclear);
      }
      expect(copy.create.repoGone).toContain(notTracked);
      expect(copy.update.repoGone).toContain(notTracked);
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
    // 觸發紀錄跟著規則刪掉：鈴鐺與儀表板不等輪詢就要拿掉
    expect(triggeredReadAgain()).toEqual([true, true]);
  });

  it("reads the triggered alerts again after a rename: the bell and the dashboard show the rule's name", async () => {
    mockUpdateAlertRule.mockResolvedValue(undefined as never);
    const { result } = renderOps();

    await act(async () => {
      await result.current.handleUpdate(1, { ...makeRule(), name: "Renamed" } as never);
    });

    expect(triggeredReadAgain()).toEqual([true, true]);
  });

  it("reads the triggered alerts again when deleting timed out: the server may have deleted it", async () => {
    mockDeleteAlertRule.mockRejectedValue(new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT));
    const { result } = renderOps();

    await act(async () => {
      await result.current.handleDelete(1);
    });

    expect(mockToast.warning).toHaveBeenCalled();
    expect(triggeredReadAgain()).toEqual([true, true]);
  });

  it("does not read the triggered alerts again before the write is back", async () => {
    let answer: () => void = () => {};
    mockDeleteAlertRule.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ status: "deleted", id: 1 });
        })
    );
    const { result } = renderOps();

    let pending: Promise<boolean> = Promise.resolve(true);
    act(() => {
      pending = result.current.handleDelete(1);
    });
    expect(triggeredReadAgain()).toEqual([false, false]);

    await act(async () => {
      answer();
      await pending;
    });
    expect(triggeredReadAgain()).toEqual([true, true]);
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
    mockCheckAlerts.mockResolvedValue({ status: "checked", triggered_count: 0, triggered: [] });

    const { result } = renderOps();

    await act(async () => {
      await result.current.handleCheckNow();
    });

    expect(mockCheckAlerts).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
    // 檢查會新增觸發紀錄：鈴鐺與儀表板不等輪詢就要列出來
    expect(triggeredReadAgain()).toEqual([true, true]);
  });

  it("reads the triggered alerts again when checking fails: a timed out check may still have triggered some", async () => {
    mockCheckAlerts.mockRejectedValue(new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT));
    const { result } = renderOps();

    await act(async () => {
      await result.current.handleCheckNow();
    });

    expect(triggeredReadAgain()).toEqual([true, true]);
  });

  it("reads the triggered alerts again only once after a check that went through", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockCheckAlerts.mockResolvedValue({ status: "checked", triggered_count: 0, triggered: [] });
      const { result } = renderOps();
      const reads = countTriggeredReads();

      let checked: boolean | undefined;
      await act(async () => {
        checked = await result.current.handleCheckNow();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
      });

      expect(checked).toBe(true);
      expect(reads()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("what the check says", () => {
    const en = translations.en;
    const failed = en.settings.alerts.failed.check;
    const withCause = (outcome: string, cause: string) =>
      interpolate(en.failure.withCause, { outcome, cause });

    async function check() {
      const { result } = renderOps();
      let checked: boolean | undefined;
      await act(async () => {
        checked = await result.current.handleCheckNow();
      });
      return checked;
    }

    it("says how many alerts it newly triggered, even when it is just one", async () => {
      mockCheckAlerts.mockResolvedValue({
        status: "checked",
        triggered_count: 1,
        triggered: [{ id: 41, rule_id: 1, repo_id: 3, signal_value: 31 }],
      });

      expect(await check()).toBe(true);

      // 寫成整句：用同一個範本算預期值的話，範本漏了 {count} 也看不出來
      expect(mockToast.success).toHaveBeenCalledTimes(1);
      expect(mockToast.success).toHaveBeenCalledWith(
        "Alert check complete. Newly triggered: 1 (see Notifications)"
      );
    });

    it("puts the count in the Chinese sentence too", () => {
      expect(translations["zh-TW"].settings.alerts.toast.checkTriggered).toContain("{count}");
    });

    it("says nothing new was triggered", async () => {
      mockCheckAlerts.mockResolvedValue({ status: "checked", triggered_count: 0, triggered: [] });

      expect(await check()).toBe(true);

      expect(mockToast.success).toHaveBeenCalledWith(en.settings.alerts.toast.checkNothingNew);
    });

    it("says it did not finish and why, without the server's own words", async () => {
      mockCheckAlerts.mockRejectedValue(new ApiError(500, "boom internal"));

      expect(await check()).toBe(false);

      expect(mockToast.error).toHaveBeenCalledTimes(1);
      expect(mockToast.error).toHaveBeenCalledWith(withCause(failed.notDone, en.failure.retry));
      expect(mockToast.warning).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it("says the engine is unreachable when the sidecar does not answer", async () => {
      mockCheckAlerts.mockRejectedValue(
        new ApiError(0, `${API_ERROR_MESSAGES.NETWORK_ERROR}: connection refused`)
      );

      expect(await check()).toBe(false);

      expect(mockToast.error).toHaveBeenCalledWith(
        withCause(failed.notDone, en.failure.engineUnreachable)
      );
    });

    it("says it is unclear, as a warning, after a timeout", async () => {
      mockCheckAlerts.mockRejectedValue(new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT));

      expect(await check()).toBe(false);

      expect(mockToast.warning).toHaveBeenCalledTimes(1);
      expect(mockToast.warning).toHaveBeenCalledWith(failed.timedOut);
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
    });
  });

  describe("after a check that did not go through", () => {
    it("still says the check failed", async () => {
      // 錯誤在 handleCheckNow 裡接住：接住之後還要照失敗處理，不能落到「檢查完成」
      mockCheckAlerts.mockRejectedValue(new ApiError(500, "Internal error"));
      const { result } = renderOps();

      let checked: boolean | undefined;
      await act(async () => {
        checked = await result.current.handleCheckNow();
      });

      expect(checked).toBe(false);
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it("keeps reading the triggered alerts again for a while after a timeout: the server may still be checking", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockCheckAlerts.mockRejectedValue(new ApiError(0, API_ERROR_MESSAGES.TIMED_OUT));
        const { result } = renderOps();
        const reads = countTriggeredReads();

        await act(async () => {
          await result.current.handleCheckNow();
        });
        expect(reads()).toBe(1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
        });
        expect(reads()).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads them again only once when the check failed for another reason", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockCheckAlerts.mockRejectedValue(new ApiError(500, "Internal error"));
        const { result } = renderOps();
        const reads = countTriggeredReads();

        await act(async () => {
          await result.current.handleCheckNow();
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
        });
        expect(reads()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("does not read the triggered alerts again before the check is back", async () => {
    let answer: () => void = () => {};
    mockCheckAlerts.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ status: "checked", triggered_count: 0, triggered: [] });
        })
    );
    const { result } = renderOps();

    let pending: Promise<boolean> = Promise.resolve(true);
    act(() => {
      pending = result.current.handleCheckNow();
    });
    expect(triggeredReadAgain()).toEqual([false, false]);
    // 檢查進行中按鈕停用：連點會送出兩次檢查
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      answer();
      await pending;
    });
    expect(triggeredReadAgain()).toEqual([true, true]);
    expect(result.current.isSubmitting).toBe(false);
  });
});
