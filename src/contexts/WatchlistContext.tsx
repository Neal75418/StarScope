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
  useEffect,
} from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  addRepo,
  unstarRepo,
  fetchRepo,
  fetchAllRepos,
  recalculateAllSimilarities,
} from "../api/client";
import { ApiError } from "../api/types";
import { useReposQuery } from "../hooks/useReposQuery";
import { useCategoryMembersQuery } from "../hooks/useCategoryQueries";
import { useBackgroundStarSync } from "../hooks/useBackgroundStarSync";
import { useAppStatus } from "./AppStatusContext";
import { probeSidecarNow } from "../api/sidecarConnection";
import { listen } from "@tauri-apps/api/event";
import { invalidateTrackedRepos, queryKeys } from "../lib/react-query";
import type { ToastMessage } from "../components/Toast";
import { getErrorMessage } from "../utils/error";
import { parseRepoString } from "../utils/importHelpers";
import { useI18n, interpolate } from "../i18n";
import { generateId } from "../utils/id";
import { logger } from "../utils/logger";
import { DATA_RESET_EVENT } from "../constants/events";
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

// Context 定義

const WatchlistStateContext = createContext<WatchlistState | undefined>(undefined);

const WatchlistActionsContext = createContext<WatchlistActions | undefined>(undefined);

// Provider 元件

interface WatchlistProviderProps {
  children: ReactNode;
}

export function WatchlistProvider({ children }: WatchlistProviderProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [reducerState, dispatch] = useReducer(watchlistReducer, initialState);

  // ── data-reset 事件：Settings 全域重置後清除 in-memory 篩選狀態 ──
  useEffect(() => {
    const handler = () => dispatch({ type: "RESET_FILTERS" });
    window.addEventListener(DATA_RESET_EVENT, handler);
    return () => window.removeEventListener(DATA_RESET_EVENT, handler);
  }, []);

  // ── 連線狀態（由 AppStatusContext 統一管理）──
  const { isSidecarUp: isConnected } = useAppStatus();

  // ── React Query：repos 資料（連線成功後才啟用）──
  const reposQuery = useReposQuery({ enabled: isConnected });

  // ── 背景星標同步（sidecar 啟動時、launchd 收集器）完成後重取追蹤名單：它們不會通知前端 ──
  useBackgroundStarSync(isConnected);

  // ── React Query：選定分類的成員。key 在 repos 前綴底下，任何重取 repo 清單的入口
  // （包括只拿得到 QueryClient 的設定頁、探索頁）都會帶著它重讀 ──
  const selectedCategoryId = reducerState.filters.selectedCategoryId;
  const membersQuery = useCategoryMembersQuery(selectedCategoryId);

  // ── 合併 React Query 資料與 reducer UI 狀態 ──
  // 保持 WatchlistState 介面不變，消費端無須修改
  const state: WatchlistState = useMemo(() => {
    // 判斷載入狀態：sidecar 連線中或 repos 載入中
    const isInitializing =
      (!isConnected || reposQuery.isLoading) && reducerState.loadingState.type === "idle";

    // 合併錯誤來源
    const queryError = reposQuery.error;
    const mergedError =
      reducerState.error ?? (queryError instanceof Error ? queryError.message : null);

    return {
      ...reducerState,
      repos: reposQuery.data ?? reducerState.repos,
      filters: {
        ...reducerState.filters,
        categoryRepoIds: membersQuery.data ?? null,
      },
      isConnected,
      loadingState: isInitializing ? { type: "initializing" as const } : reducerState.loadingState,
      error: mergedError,
    };
  }, [
    reducerState,
    reposQuery.data,
    reposQuery.isLoading,
    reposQuery.error,
    isConnected,
    membersQuery.data,
  ]);

  // 用 ref 持有最新 state，讓 actions 不依賴 state 變化
  const stateRef = useRef(state);
  stateRef.current = state;

  // 空 deps 的 useCallback：只依賴穩定的 dispatch，讓 toast 便利方法引用永遠穩定
  const showToastFn = useCallback((type: ToastMessage["type"], message: string) => {
    const id = generateId();
    dispatch({
      type: "SHOW_TOAST",
      payload: { id, type, message },
    });
  }, []);

  // 選定分類的成員從沒載入成功過（沒有任何成員可用）：回到「全部」並提示。已經有成員時的
  // 重讀失敗保留舊成員——清單仍照這個分類篩選，只是可能稍舊。換分類時舊請求由 React Query
  // 中止，不會變成失敗；失敗與改選落在同一個 tick 時，reducer 會比對 categoryId
  const categoryLoadFailed = membersQuery.isLoadingError;
  const categoryLoadError = membersQuery.error;
  useEffect(() => {
    if (!categoryLoadFailed || selectedCategoryId === null) return;
    logger.error("[Watchlist] 分類 Repo 載入失敗:", categoryLoadError);
    dispatch({
      type: "CATEGORY_LOAD_FAILED",
      payload: {
        categoryId: selectedCategoryId,
        toast: { id: generateId(), type: "error", message: t.toast.categoryLoadFailed },
      },
    });
  }, [categoryLoadFailed, categoryLoadError, selectedCategoryId, t]);

  // invalidate repos cache 的便利函式：選定分類的成員與分類樹都在 repos 前綴底下，會一起重讀
  const invalidateRepos = useCallback(() => {
    invalidateTrackedRepos(qc);
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
          await unstarRepo(repoId);
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
          const result = await fetchAllRepos();
          dispatch({ type: "REFRESH_ALL_SUCCESS" });
          invalidateRepos();
          // 部分（甚至全部）失敗不能無聲：94/94 失敗時後端仍回 200，
          // 沒有這個 toast 的話畫面轉圈結束＝使用者以為資料是新的
          if (result.failed_count) {
            showToastFn(
              "error",
              interpolate(t.toast.refreshPartial, {
                ok: result.success_count ?? 0,
                failed: result.failed_count,
              })
            );
          }
        } catch (err) {
          // 409 = 後端已經在抓（排程觸發的，或另一個視窗按的）。使用者要的結果
          // 正在發生，這不是失敗——報錯會讓他再按一次，而那次同樣會撞到鎖。
          // 進行中的狀態由 diagnostics 的 fetch_in_progress 接手顯示。
          if (err instanceof ApiError && err.status === 409) {
            dispatch({ type: "REFRESH_ALL_SUCCESS" });
            invalidateRepos();
            return;
          }
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

        dispatch({ type: "REMOVE_REPO_START", payload: { repoId } });

        try {
          await unstarRepo(repoId);
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
      setCategory: (categoryId: number | null) => {
        dispatch({ type: "SET_CATEGORY", payload: { categoryId } });
        // 再點一次同一個分類＝重讀它的成員；換到看過的分類時先顯示快取、再重讀
        if (categoryId !== null) {
          void qc.invalidateQueries({
            queryKey: queryKeys.repos.categoryMembers(categoryId),
            exact: true,
          });
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

      // 輕量同步 — 僅 invalidate React Query cache（含分類樹與選定分類的成員），不重抓 GitHub
      invalidateRepos,

      // 連線重試 — invalidate React Query cache 觸發重新取得
      retry: async () => {
        dispatch({ type: "CLEAR_ERROR" });
        probeSidecarNow();
        invalidateRepos();
      },
    }),
    [qc, t, showToastFn, invalidateRepos]
  );

  // 監聽 Tauri tray「Refresh All」事件
  useEffect(() => {
    // cleanup 是同步的，而 unlisten 要等 promise 之後才有值：effect 在
    // promise 落地前重跑（StrictMode 的 mount→unmount→mount 必中）時，cleanup
    // 讀到 undefined、之後的指派寫進死掉的 closure → listener 永不解除，
    // 系統匣按一次 Refresh All 會疊送多次。cancelled 旗標讓遲到的註冊自我解除。
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<void>("refresh-all", () => {
      void actions.refreshAll();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // 非 Tauri 環境（開發模式 / 測試），忽略
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [actions]);

  return (
    <WatchlistStateContext.Provider value={state}>
      <WatchlistActionsContext.Provider value={actions}>
        {children}
      </WatchlistActionsContext.Provider>
    </WatchlistStateContext.Provider>
  );
}

// 自訂 Hooks

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
