/**
 * Watchlist Context：集中化的狀態管理。
 *
 * 資料層由 React Query 管理（repos 快取、請求去重、自動重試），
 * Context + useReducer 只負責 UI 狀態（dialog、filters、loadingState）；toast 交給 app 層的 ToastProvider。
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
import { useBackgroundStarSync } from "../hooks/useBackgroundStarSync";
import { useAppStatus } from "./AppStatusContext";
import { probeSidecarNow } from "../api/sidecarConnection";
import { listen } from "@tauri-apps/api/event";
import { invalidateTrackedRepos, loadStatus, type LoadStatus } from "../lib/react-query";
import { useToast, type ToastMessage } from "../components/Toast";
import { getErrorMessage } from "../utils/error";
import { parseRepoString } from "../utils/importHelpers";
import { useI18n, interpolate } from "../i18n";
import { DATA_RESET_EVENT } from "../constants/events";
import {
  watchlistReducer,
  initialState,
  type WatchlistReducerState,
  type WatchlistActions,
} from "./watchlistReducer";

export type { LoadingState, WatchlistAction, WatchlistActions } from "./watchlistReducer";

/** Provider 給出去的狀態：reducer 管的 UI 狀態，加上從 React Query 併進來的追蹤清單與它的讀取狀態 */
export interface WatchlistState extends WatchlistReducerState {
  /**
   * 追蹤清單讀到了沒：頁面依它顯示「讀不到＋重試」，以及能不能說「清單是空的」。
   * 這裡的 inProgress 只代表讀不到之後的重讀；平常的背景重讀不算
   */
  reposLoad: LoadStatus;
}

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

  // ── 背景星標同步（sidecar 啟動時、launchd 收集器）與抓取（排程、收集器）完成後重取追蹤名單與儀表板：它們不會通知前端 ──
  useBackgroundStarSync(isConnected);

  // ── 合併 React Query 資料與 reducer UI 狀態 ──
  // 追蹤清單讀到了沒。讀不到由頁面原地的「讀不到＋重試」說，不放進 error：那是操作失敗用的橫幅，
  // 只有後端的原始訊息。拆成三個布林值進 useMemo 的依賴——loadStatus 每次回新的物件，
  // 整個放進去的話 state 每次 render 都換，所有讀 state 的元件跟著重畫
  const {
    ready: reposReady,
    failed: reposFailed,
    inProgress: reposInProgress,
  } = loadStatus(reposQuery);
  // 「讀取進行中」只在讀不到之後才有人看（重試鈕）。沒失敗時不讓它進 state：
  // 否則每次背景重讀（同步、invalidate）一開始一結束，state 各換一次，所有讀 state 的元件白白重畫
  const reposRetrying = reposFailed && reposInProgress;
  const refetchRepos = reposQuery.refetch;
  const state: WatchlistState = useMemo(() => {
    // 判斷載入狀態：sidecar 連線中或 repos 第一次載入中。失敗之後的重試不算——還沒有資料時重試一開始
    // isLoading 又是 true，當成初始化中的話整頁換成載入畫面，頁面上的「讀不到＋重試」跟著消失
    const isInitializing =
      (!isConnected || (reposQuery.isLoading && !reposFailed)) &&
      reducerState.loadingState.type === "idle";

    return {
      ...reducerState,
      repos: reposQuery.data ?? reducerState.repos,
      isConnected,
      loadingState: isInitializing ? { type: "initializing" as const } : reducerState.loadingState,
      reposLoad: {
        ready: reposReady,
        failed: reposFailed,
        inProgress: reposRetrying,
        retry: () => void refetchRepos(),
      },
    };
  }, [
    reducerState,
    reposQuery.data,
    reposQuery.isLoading,
    isConnected,
    reposReady,
    reposFailed,
    reposRetrying,
    refetchRepos,
  ]);

  // 用 ref 持有最新 state，讓 actions 不依賴 state 變化
  const stateRef = useRef(state);
  stateRef.current = state;

  // toast 交給 app 層的 ToastProvider 顯示：存在這裡的話只有 Watchlist 頁看得到，
  // 從 Dashboard 等頁觸發的失敗要等使用者切到 Watchlist 才冒出來。toast 的方法引用是穩定的
  const toast = useToast();
  const showToastFn = useCallback(
    (type: ToastMessage["type"], message: string) => {
      toast.addToast(type, message);
    },
    [toast]
  );

  // invalidate repos cache 的便利函式：分類樹、訊號、警報規則也會一起重讀（見 invalidateTrackedRepos）
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
          // state.error 只有追蹤清單頁的 ErrorBanner 會顯示：從儀表板或系統匣觸發時，當下的頁面要靠 toast 才看得到
          showToastFn("error", error);
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
      // 分類篩選用每個 repo 自己的 category_ids（追蹤清單回傳時就帶著），選下去就生效，不發請求
      setCategory: (categoryId: number | null) =>
        dispatch({ type: "SET_CATEGORY", payload: { categoryId } }),

      setSearchQuery: (query: string) => dispatch({ type: "SET_SEARCH_QUERY", payload: { query } }),

      // Toast 操作
      showToast: showToastFn,

      success: (message: string) => showToastFn("success", message),
      error: (message: string) => showToastFn("error", message),
      info: (message: string) => showToastFn("info", message),
      warning: (message: string) => showToastFn("warning", message),

      // 錯誤處理
      clearError: () => dispatch({ type: "CLEAR_ERROR" }),

      // 輕量同步 — 僅 invalidate React Query cache，不重抓 GitHub
      invalidateRepos,

      // 連線重試 — invalidate React Query cache 觸發重新取得
      retry: async () => {
        dispatch({ type: "CLEAR_ERROR" });
        probeSidecarNow();
        invalidateRepos();
      },
    }),
    [t, showToastFn, invalidateRepos]
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
