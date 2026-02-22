/**
 * Watchlist Context：集中化的狀態管理。
 *
 * 資料層由 React Query 管理（repos 快取、請求去重、自動重試），
 * Context + useReducer 只負責 UI 狀態（dialog、filters、toasts、loadingState）。
 */

import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addRepo,
  removeRepo,
  fetchRepo,
  fetchAllRepos,
  recalculateAllSimilarities,
  checkHealth,
  getCategoryRepos,
} from "../api/client";
import { useReposQuery } from "../hooks/useReposQuery";
import { queryKeys } from "../lib/react-query";
import type { ToastMessage } from "../components/Toast";
import { getErrorMessage } from "../utils/error";
import { parseRepoString } from "../utils/importHelpers";
import { useI18n } from "../i18n";
import { generateId } from "../utils/id";
import { logger } from "../utils/logger";
import {
  watchlistReducer,
  initialState,
  type WatchlistState,
  type WatchlistActions,
} from "./watchlistReducer";

export type {
  LoadingState,
  WatchlistState,
  WatchlistAction,
  WatchlistActions,
} from "./watchlistReducer";

// ==================== Contexts ====================

const WatchlistStateContext = createContext<WatchlistState | undefined>(undefined);

const WatchlistActionsContext = createContext<WatchlistActions | undefined>(undefined);

// ==================== Provider ====================

interface WatchlistProviderProps {
  children: ReactNode;
}

export function WatchlistProvider({ children }: WatchlistProviderProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [reducerState, dispatch] = useReducer(watchlistReducer, initialState);

  // ── React Query：連線檢查 ──
  const healthQuery = useQuery({
    queryKey: queryKeys.dashboard.health,
    queryFn: checkHealth,
    retry: 1,
    staleTime: 1000 * 60,
  });
  const isConnected = healthQuery.data?.status === "ok";

  // ── React Query：repos 資料（連線成功後才啟用）──
  const reposQuery = useReposQuery({ enabled: isConnected });

  // ── 合併 React Query 資料與 reducer UI 狀態 ──
  // 保持 WatchlistState 介面不變，消費端無須修改
  const state: WatchlistState = useMemo(() => {
    // 判斷載入狀態：React Query 載入中且 reducer 空閒時視為初始化
    const isInitializing =
      (healthQuery.isLoading || (isConnected && reposQuery.isLoading)) &&
      reducerState.loadingState.type === "idle";

    // 合併錯誤來源
    const queryError = healthQuery.error ?? reposQuery.error;
    const mergedError =
      reducerState.error ??
      (!isConnected && !healthQuery.isLoading ? t.watchlist.connection.message : null) ??
      (queryError instanceof Error ? queryError.message : null);

    return {
      ...reducerState,
      repos: reposQuery.data ?? reducerState.repos,
      isConnected,
      loadingState: isInitializing ? { type: "initializing" as const } : reducerState.loadingState,
      error: mergedError,
    };
  }, [
    reducerState,
    reposQuery.data,
    reposQuery.isLoading,
    reposQuery.error,
    healthQuery.isLoading,
    healthQuery.error,
    isConnected,
    t,
  ]);

  // 用 ref 持有最新 state，讓 actions 不依賴 state 變化
  const stateRef = useRef(state);
  stateRef.current = state;

  // 分類切換用 AbortController，防止快速切換時競態
  const categoryAbortRef = useRef<AbortController | null>(null);

  // 用 ref 持有 showToast，讓 toast 便利方法不依賴自身
  const showToastFn = useCallback((type: ToastMessage["type"], message: string) => {
    const id = generateId();
    dispatch({
      type: "SHOW_TOAST",
      payload: { id, type, message },
    });
  }, []);

  // invalidate repos cache 的便利函式
  const invalidateRepos = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
  }, [qc]);

  // Actions - 使用 ref 讀取 state，確保 actions 引用穩定
  const actions = useMemo<WatchlistActions>(
    () => ({
      // Repo 操作 — 呼叫 API 後 invalidate React Query cache
      addRepo: async (input: string) => {
        const parsed = parseRepoString(input);
        if (!parsed) {
          return {
            success: false,
            error: t.dialog.addRepo.invalidFormat,
          };
        }

        dispatch({
          type: "ADD_REPO_START",
          payload: { fullName: `${parsed.owner}/${parsed.name}` },
        });

        try {
          await addRepo({ owner: parsed.owner, name: parsed.name });
          dispatch({ type: "ADD_REPO_SUCCESS" });
          invalidateRepos();
          return { success: true };
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({ type: "ADD_REPO_FAILURE", payload: { error } });
          return { success: false, error };
        }
      },

      removeRepo: async (repoId: number) => {
        dispatch({ type: "REMOVE_REPO_START", payload: { repoId } });

        try {
          await removeRepo(repoId);
          dispatch({ type: "REMOVE_REPO_SUCCESS" });
          invalidateRepos();
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({ type: "REMOVE_REPO_FAILURE", payload: { error } });
          throw err;
        }
      },

      fetchRepo: async (repoId: number) => {
        dispatch({ type: "FETCH_REPO_START", payload: { repoId } });

        try {
          await fetchRepo(repoId);
          dispatch({ type: "FETCH_REPO_SUCCESS" });
          invalidateRepos();
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({
            type: "FETCH_REPO_FAILURE",
            payload: { repoId, error },
          });
        }
      },

      refreshAll: async () => {
        const repoIds = stateRef.current.repos.map((r) => r.id);
        dispatch({ type: "REFRESH_ALL_START", payload: { repoIds } });

        try {
          await fetchAllRepos();
          dispatch({ type: "REFRESH_ALL_SUCCESS" });
          invalidateRepos();
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({ type: "REFRESH_ALL_FAILURE", payload: { error } });
        }
      },

      recalculateAll: async () => {
        dispatch({ type: "RECALCULATE_START" });

        try {
          await recalculateAllSimilarities();
          dispatch({ type: "RECALCULATE_SUCCESS" });
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({ type: "RECALCULATE_FAILURE", payload: { error } });
        }
      },

      // UI 操作
      openDialog: () => dispatch({ type: "OPEN_DIALOG" }),
      closeDialog: () => dispatch({ type: "CLOSE_DIALOG" }),

      openRemoveConfirm: (repoId: number, repoName: string) =>
        dispatch({
          type: "OPEN_REMOVE_CONFIRM",
          payload: { repoId, repoName },
        }),

      closeRemoveConfirm: () => dispatch({ type: "CLOSE_REMOVE_CONFIRM" }),

      confirmRemove: async () => {
        const { repoId } = stateRef.current.ui.removeConfirm;
        if (repoId === null) return;

        try {
          await removeRepo(repoId);
          dispatch({ type: "REMOVE_REPO_SUCCESS" });
          invalidateRepos();
          showToastFn("success", t.toast.repoRemoved);
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({ type: "REMOVE_REPO_FAILURE", payload: { error } });
        }
      },

      cancelRemove: () => dispatch({ type: "CLOSE_REMOVE_CONFIRM" }),

      // 篩選操作
      setCategory: async (categoryId: number | null) => {
        categoryAbortRef.current?.abort();
        categoryAbortRef.current = null;

        dispatch({ type: "SET_CATEGORY", payload: { categoryId } });

        if (categoryId === null) return;

        const controller = new AbortController();
        categoryAbortRef.current = controller;

        try {
          const response = await getCategoryRepos(categoryId, controller.signal);
          if (!controller.signal.aborted) {
            dispatch({
              type: "SET_CATEGORY_REPOS",
              payload: { repoIds: response.repos.map((r) => r.id) },
            });
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          logger.error("[Watchlist] 分類 Repo 載入失敗:", err);
          dispatch({ type: "SET_CATEGORY_REPOS", payload: { repoIds: null } });
        }
      },

      setSearchQuery: (query: string) => dispatch({ type: "SET_SEARCH_QUERY", payload: { query } }),

      // Toast 操作
      showToast: showToastFn,

      dismissToast: (id: string) => dispatch({ type: "DISMISS_TOAST", payload: { id } }),

      success: (message: string) => showToastFn("success", message),
      error: (message: string) => showToastFn("error", message),
      info: (message: string) => showToastFn("info", message),
      warning: (message: string) => showToastFn("warning", message),

      // 錯誤處理
      clearError: () => dispatch({ type: "CLEAR_ERROR" }),

      // 連線重試 — invalidate React Query cache 觸發重新取得
      retry: async () => {
        dispatch({ type: "CLEAR_ERROR" });
        void qc.invalidateQueries({ queryKey: queryKeys.dashboard.health });
        invalidateRepos();
      },
    }),
    [t, showToastFn, invalidateRepos, qc]
  );

  return (
    <WatchlistStateContext.Provider value={state}>
      <WatchlistActionsContext.Provider value={actions}>
        {children}
      </WatchlistActionsContext.Provider>
    </WatchlistStateContext.Provider>
  );
}

// ==================== Hooks ====================

export function useWatchlistState(): WatchlistState {
  const context = useContext(WatchlistStateContext);
  if (context === undefined) {
    throw new Error("useWatchlistState must be used within WatchlistProvider");
  }
  return context;
}

export function useWatchlistActions(): WatchlistActions {
  const context = useContext(WatchlistActionsContext);
  if (context === undefined) {
    throw new Error("useWatchlistActions must be used within WatchlistProvider");
  }
  return context;
}
