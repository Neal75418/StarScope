/**
 * Watchlist Context：集中化的狀態管理，使用 Context + useReducer 架構。
 * 取代原本分散的 14 個 useState，改用 State Machine Pattern 管理載入狀態。
 */

import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import {
  getRepos,
  addRepo,
  removeRepo,
  fetchRepo,
  fetchAllRepos,
  recalculateAllSimilarities,
  checkHealth,
  getCategoryRepos,
} from "../api/client";
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

// ============================================================================
// Contexts
// ============================================================================

const WatchlistStateContext = createContext<WatchlistState | undefined>(undefined);

const WatchlistActionsContext = createContext<WatchlistActions | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface WatchlistProviderProps {
  children: ReactNode;
}

export function WatchlistProvider({ children }: WatchlistProviderProps) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(watchlistReducer, initialState);

  // 避免 StrictMode 重複請求
  const hasInitializedRef = useRef(false);

  // 初始載入
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const init = async () => {
      dispatch({ type: "INITIALIZE_START" });

      try {
        // 檢查連線
        const healthResponse = await checkHealth();
        const isConnected = healthResponse.status === "ok";
        dispatch({ type: "SET_CONNECTION_STATUS", payload: { isConnected } });

        if (isConnected) {
          // 載入 repos
          const response = await getRepos();
          dispatch({
            type: "INITIALIZE_SUCCESS",
            payload: { repos: response.repos },
          });
        } else {
          dispatch({
            type: "INITIALIZE_FAILURE",
            payload: { error: t.watchlist.connection.message },
          });
        }
      } catch (err) {
        dispatch({
          type: "SET_CONNECTION_STATUS",
          payload: { isConnected: false },
        });
        dispatch({
          type: "INITIALIZE_FAILURE",
          payload: { error: getErrorMessage(err, t.common.error) },
        });
      }
    };

    void init();
    // init 只需掛載時執行一次，內部使用的 dispatch/t 透過閉包取得
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用 ref 持有最新 state，讓 actions 不依賴 state 變化
  const stateRef = useRef(state);
  stateRef.current = state;

  // 用 ref 持有 showToast，讓 toast 便利方法不依賴自身
  const showToastFn = useCallback((type: ToastMessage["type"], message: string) => {
    const id = generateId();
    dispatch({
      type: "SHOW_TOAST",
      payload: { id, type, message },
    });
  }, []);

  // Actions - 使用 ref 讀取 state，確保 actions 引用穩定
  // deps 只依賴 t（語言切換時才需要更新）
  const actions = useMemo<WatchlistActions>(
    () => ({
      // Repo 操作
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
          const newRepo = await addRepo({
            owner: parsed.owner,
            name: parsed.name,
          });
          dispatch({ type: "ADD_REPO_SUCCESS", payload: { repo: newRepo } });
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
          dispatch({ type: "REMOVE_REPO_SUCCESS", payload: { repoId } });
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({ type: "REMOVE_REPO_FAILURE", payload: { error } });
          throw err;
        }
      },

      fetchRepo: async (repoId: number) => {
        dispatch({ type: "FETCH_REPO_START", payload: { repoId } });

        try {
          const updatedRepo = await fetchRepo(repoId);
          dispatch({
            type: "FETCH_REPO_SUCCESS",
            payload: { repo: updatedRepo },
          });
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
          const response = await fetchAllRepos();
          dispatch({
            type: "REFRESH_ALL_SUCCESS",
            payload: { repos: response.repos },
          });
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
          dispatch({ type: "REMOVE_REPO_SUCCESS", payload: { repoId } });
          showToastFn("success", t.toast.repoRemoved);
        } catch (err) {
          const error = getErrorMessage(err, t.common.error);
          dispatch({ type: "REMOVE_REPO_FAILURE", payload: { error } });
        }
      },

      cancelRemove: () => dispatch({ type: "CLOSE_REMOVE_CONFIRM" }),

      // 篩選操作
      setCategory: async (categoryId: number | null) => {
        dispatch({ type: "SET_CATEGORY", payload: { categoryId } });

        if (categoryId === null) return;

        try {
          const response = await getCategoryRepos(categoryId);
          // 防競態：確認 selectedCategoryId 仍為當前值
          if (stateRef.current.filters.selectedCategoryId === categoryId) {
            dispatch({
              type: "SET_CATEGORY_REPOS",
              payload: { repoIds: response.repos.map((r) => r.id) },
            });
          }
        } catch (err) {
          logger.error("Failed to load category repos:", err);
          if (stateRef.current.filters.selectedCategoryId === categoryId) {
            dispatch({ type: "SET_CATEGORY_REPOS", payload: { repoIds: null } });
          }
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

      // 連線重試
      retry: async () => {
        dispatch({ type: "INITIALIZE_START" });
        dispatch({ type: "CLEAR_ERROR" });

        try {
          const healthResponse = await checkHealth();
          const isConnected = healthResponse.status === "ok";
          dispatch({
            type: "SET_CONNECTION_STATUS",
            payload: { isConnected },
          });

          if (isConnected) {
            const response = await getRepos();
            dispatch({
              type: "INITIALIZE_SUCCESS",
              payload: { repos: response.repos },
            });
          } else {
            dispatch({
              type: "INITIALIZE_FAILURE",
              payload: { error: t.watchlist.connection.message },
            });
          }
        } catch (err) {
          dispatch({
            type: "SET_CONNECTION_STATUS",
            payload: { isConnected: false },
          });
          dispatch({
            type: "INITIALIZE_FAILURE",
            payload: { error: getErrorMessage(err, t.common.error) },
          });
        }
      },
    }),
    // 只依賴 t（語言切換）和 showToastFn（穩定引用）
    // state 透過 stateRef 讀取，不觸發 actions 重建
    [t, showToastFn]
  );

  return (
    <WatchlistStateContext.Provider value={state}>
      <WatchlistActionsContext.Provider value={actions}>
        {children}
      </WatchlistActionsContext.Provider>
    </WatchlistStateContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

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
