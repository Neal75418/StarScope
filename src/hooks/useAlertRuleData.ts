/**
 * 警報規則資料取得與狀態管理。
 */

import { useState, useRef, useCallback, useEffect } from "react";
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

interface Toast {
  error: (msg: string) => void;
}

export function useAlertRuleData(toast: Toast) {
  const { t } = useI18n();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [signalTypes, setSignalTypes] = useState<SignalTypeInfo[]>([]);
  const [repos, setRepos] = useState<RepoWithSignals[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 用 ref 持有最新的 toast 和 t，讓 useCallback 穩定
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  const loadRules = useCallback(async () => {
    try {
      const data = await listAlertRules();
      setRules(data);
    } catch (err) {
      toastRef.current.error(getErrorMessage(err, tRef.current.common.error));
    }
  }, []);

  const loadSignalTypes = useCallback(async () => {
    try {
      const data = await listSignalTypes();
      setSignalTypes(data);
    } catch (err) {
      toastRef.current.error(getErrorMessage(err, tRef.current.common.error));
    }
  }, []);

  const loadRepos = useCallback(async () => {
    try {
      const response = await getRepos();
      setRepos(response.repos);
    } catch (err) {
      toastRef.current.error(getErrorMessage(err, tRef.current.common.error));
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([loadRules(), loadSignalTypes(), loadRepos()]).finally(() => setIsLoading(false));
  }, [loadRules, loadSignalTypes, loadRepos]);

  return {
    rules,
    setRules, // 開放給 optimistic update 使用
    signalTypes,
    repos,
    isLoading,
    loadRules,
  };
}
