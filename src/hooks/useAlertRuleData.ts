/**
 * 警報規則資料取得與狀態管理。
 * 使用 3 個 useQuery 平行取得 rules、signalTypes、repos。
 */

import { useCallback, useRef, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertRule,
  SignalTypeInfo,
  listAlertRules,
  listSignalTypes,
  getRepos,
  RepoWithSignals,
} from "../api/client";
import { useI18n } from "../i18n";
import { getErrorMessage } from "../utils/error";
import type { Toast } from "./types";
import { queryKeys } from "../lib/react-query";

export function useAlertRuleData(toast: Toast) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // 用 ref 持有最新的 toast 和 t，讓 error effect 穩定
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

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

  // 透過 effect 顯示錯誤 toast，避免在 render 中觸發副作用
  useEffect(() => {
    const errors = [rulesQuery.error, signalTypesQuery.error, reposQuery.error];
    for (const err of errors) {
      if (err) {
        toastRef.current.error(getErrorMessage(err, tRef.current.common.error));
      }
    }
  }, [rulesQuery.error, signalTypesQuery.error, reposQuery.error]);

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
    isLoading: rulesQuery.isLoading || signalTypesQuery.isLoading || reposQuery.isLoading,
    loadRules,
  };
}
