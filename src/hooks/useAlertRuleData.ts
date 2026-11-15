/**
 * 警報規則資料取得與狀態管理。
 * 使用 3 個 useQuery 平行取得 rules、signalTypes、repos。
 */

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAlertRules, listSignalTypes, getRepos } from "../api/client";
import type { AlertRule, SignalTypeInfo, RepoWithSignals } from "../api/client";
import { combineLoadStatus, loadStatus, queryKeys } from "../lib/react-query";

export function useAlertRuleData() {
  const queryClient = useQueryClient();

  const rulesQuery = useQuery<AlertRule[], Error>({
    queryKey: queryKeys.alertRuleData.rules(),
    queryFn: () => listAlertRules(),
  });

  const signalTypesQuery = useQuery<SignalTypeInfo[], Error>({
    queryKey: queryKeys.alertRuleData.signalTypes(),
    queryFn: () => listSignalTypes(),
  });

  const reposQuery = useQuery<RepoWithSignals[], Error>({
    queryKey: queryKeys.repos.lists(),
    queryFn: async () => {
      const response = await getRepos();
      return response.repos;
    },
  });

  // 讀不到由畫面上的「讀不到＋重試」說（設定頁的警報區塊），不丟 toast：toast 只有後端的原始訊息，
  // 看不出是哪一塊讀不到，幾秒後就消失
  const rulesLoad = loadStatus(rulesQuery);
  const dataLoad = combineLoadStatus([
    rulesLoad,
    loadStatus(signalTypesQuery),
    loadStatus(reposQuery),
  ]);

  const setRules: Dispatch<SetStateAction<AlertRule[]>> = useCallback(
    (updater) => {
      queryClient.setQueryData<AlertRule[]>(queryKeys.alertRuleData.rules(), (prev) => {
        const current = prev ?? [];
        if (typeof updater === "function") {
          return updater(current);
        }
        return updater;
      });
    },
    [queryClient]
  );

  const loadRules = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.alertRuleData.rules() });
  }, [queryClient]);

  return {
    rules: rulesQuery.data ?? [],
    setRules,
    signalTypes: signalTypesQuery.data ?? [],
    repos: reposQuery.data ?? [],
    /** 規則清單讀到了沒：清單與「尚未設定警報規則」看這個 */
    rulesLoad,
    /** 整個警報區塊用到的三份資料（規則、訊號類型、repo）合起來：「讀不到＋重試」看這個 */
    dataLoad,
    loadRules,
  };
}
