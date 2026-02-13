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
  Dispatch,
  ReactNode,
} from "react";
import {
  RepoWithSignals,
  getRepos,
  addRepo,
  removeRepo,
  fetchRepo,
  fetchAllRepos,
  recalculateAllSimilarities,
} from "../api/client";
import { ToastMessage } from "../components/Toast";
import { getErrorMessage } from "../utils/error";
import { parseRepoString } from "../utils/importHelpers";
import { useI18n } from "../i18n";
import { checkHealth } from "../api/client";

// ============================================================================
// Types
// ============================================================================

/**
 * State Machine Pattern - 使用 Discriminated Unions 消除不可能狀態
 * 確保任何時候只能處於一種載入狀態
 */
export type LoadingState =
  | { type: "idle" }
  | { type: "initializing" }
  | { type: "refreshing"; repoIds: number[] }
  | { type: "fetching"; repoId: number }
  | { type: "adding"; fullName: string }
  | { type: "removing"; repoId: number }
  | { type: "recalculating" };

/**
 * Watchlist 主要狀態（2 層嵌套，比原本的 4 層簡化）
 */
export interface WatchlistState {
  // 主要資料
  repos: RepoWithSignals[];
  loadingState: LoadingState;
  error: string | null;
  isConnected: boolean;

  // UI 狀態
  ui: {
    dialog: {
      isOpen: boolean;
      error: string | null;
    };
    removeConfirm: {
      isOpen: boolean;
      repoId: number | null;
      repoName: string;
    };
  };

  // 篩選狀態
  filters: {
    selectedCategoryId: number | null;
    searchQuery: string;
  };

  // 通知狀態
  toasts: ToastMessage[];
}

/**
 * Reducer Actions - 使用語意化的 action types
 */
export type WatchlistAction =
  // 初始化
  | { type: "INITIALIZE_START" }
  | { type: "INITIALIZE_SUCCESS"; payload: { repos: RepoWithSignals[] } }
  | { type: "INITIALIZE_FAILURE"; payload: { error: string } }
  | { type: "SET_CONNECTION_STATUS"; payload: { isConnected: boolean } }

  // Repo 操作
  | { type: "ADD_REPO_START"; payload: { fullName: string } }
  | { type: "ADD_REPO_SUCCESS"; payload: { repo: RepoWithSignals } }
  | { type: "ADD_REPO_FAILURE"; payload: { error: string } }
  | { type: "REMOVE_REPO_START"; payload: { repoId: number } }
  | { type: "REMOVE_REPO_SUCCESS"; payload: { repoId: number } }
  | { type: "REMOVE_REPO_FAILURE"; payload: { error: string } }
  | { type: "FETCH_REPO_START"; payload: { repoId: number } }
  | { type: "FETCH_REPO_SUCCESS"; payload: { repo: RepoWithSignals } }
  | { type: "FETCH_REPO_FAILURE"; payload: { repoId: number; error: string } }

  // 批次操作
  | { type: "REFRESH_ALL_START"; payload: { repoIds: number[] } }
  | { type: "REFRESH_ALL_SUCCESS"; payload: { repos: RepoWithSignals[] } }
  | { type: "REFRESH_ALL_FAILURE"; payload: { error: string } }
  | { type: "RECALCULATE_START" }
  | { type: "RECALCULATE_SUCCESS" }
  | { type: "RECALCULATE_FAILURE"; payload: { error: string } }

  // UI 操作
  | { type: "OPEN_DIALOG" }
  | { type: "CLOSE_DIALOG" }
  | { type: "CLEAR_DIALOG_ERROR" }
  | {
      type: "OPEN_REMOVE_CONFIRM";
      payload: { repoId: number; repoName: string };
    }
  | { type: "CLOSE_REMOVE_CONFIRM" }

  // 篩選操作
  | { type: "SET_CATEGORY"; payload: { categoryId: number | null } }
  | { type: "SET_SEARCH_QUERY"; payload: { query: string } }

  // Toast 操作
  | { type: "SHOW_TOAST"; payload: ToastMessage }
  | { type: "DISMISS_TOAST"; payload: { id: string } }

  // 錯誤處理
  | { type: "CLEAR_ERROR" };

/**
 * Actions 介面 - 業務邏輯層
 */
export interface WatchlistActions {
  // Repo 操作
  addRepo: (input: string) => Promise<{ success: boolean; error?: string }>;
  removeRepo: (repoId: number) => Promise<void>;
  fetchRepo: (repoId: number) => Promise<void>;

  // 批次操作
  refreshAll: () => Promise<void>;
  recalculateAll: () => Promise<void>;

  // UI 操作
  openDialog: () => void;
  closeDialog: () => void;
  openRemoveConfirm: (repoId: number, repoName: string) => void;
  closeRemoveConfirm: () => void;
  confirmRemove: () => Promise<void>;
  cancelRemove: () => void;

  // 篩選操作
  setCategory: (categoryId: number | null) => void;
  setSearchQuery: (query: string) => void;

  // Toast 操作
  showToast: (type: ToastMessage["type"], message: string) => void;
  dismissToast: (id: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;

  // 錯誤處理
  clearError: () => void;

  // 連線重試
  retry: () => Promise<void>;
}

// ============================================================================
// Reducer
// ============================================================================

const initialState: WatchlistState = {
  repos: [],
  loadingState: { type: "idle" },
  error: null,
  isConnected: false,
  ui: {
    dialog: {
      isOpen: false,
      error: null,
    },
    removeConfirm: {
      isOpen: false,
      repoId: null,
      repoName: "",
    },
  },
  filters: {
    selectedCategoryId: null,
    searchQuery: "",
  },
  toasts: [],
};

/**
 * Watchlist Reducer - 純函數，集中管理所有狀態變更
 */
export function watchlistReducer(state: WatchlistState, action: WatchlistAction): WatchlistState {
  switch (action.type) {
    // 初始化
    case "INITIALIZE_START":
      return {
        ...state,
        loadingState: { type: "initializing" },
        error: null,
      };

    case "INITIALIZE_SUCCESS":
      return {
        ...state,
        repos: action.payload.repos,
        loadingState: { type: "idle" },
        error: null,
      };

    case "INITIALIZE_FAILURE":
      return {
        ...state,
        loadingState: { type: "idle" },
        error: action.payload.error,
      };

    case "SET_CONNECTION_STATUS":
      return {
        ...state,
        isConnected: action.payload.isConnected,
      };

    // 新增 Repo
    case "ADD_REPO_START":
      return {
        ...state,
        loadingState: { type: "adding", fullName: action.payload.fullName },
        ui: {
          ...state.ui,
          dialog: {
            isOpen: true,
            error: null,
          },
        },
      };

    case "ADD_REPO_SUCCESS":
      return {
        ...state,
        repos: [action.payload.repo, ...state.repos].sort((a, b) =>
          a.full_name.localeCompare(b.full_name)
        ),
        loadingState: { type: "idle" },
        ui: {
          ...state.ui,
          dialog: {
            isOpen: false,
            error: null,
          },
        },
      };

    case "ADD_REPO_FAILURE":
      return {
        ...state,
        loadingState: { type: "idle" },
        ui: {
          ...state.ui,
          dialog: {
            ...state.ui.dialog,
            error: action.payload.error,
          },
        },
      };

    // 移除 Repo
    case "REMOVE_REPO_START":
      return {
        ...state,
        loadingState: { type: "removing", repoId: action.payload.repoId },
      };

    case "REMOVE_REPO_SUCCESS":
      return {
        ...state,
        repos: state.repos.filter((r) => r.id !== action.payload.repoId),
        loadingState: { type: "idle" },
        ui: {
          ...state.ui,
          removeConfirm: {
            isOpen: false,
            repoId: null,
            repoName: "",
          },
        },
      };

    case "REMOVE_REPO_FAILURE":
      return {
        ...state,
        loadingState: { type: "idle" },
        error: action.payload.error,
      };

    // 刷新單一 Repo
    case "FETCH_REPO_START":
      return {
        ...state,
        loadingState: { type: "fetching", repoId: action.payload.repoId },
        error: null,
      };

    case "FETCH_REPO_SUCCESS":
      return {
        ...state,
        repos: state.repos.map((r) => (r.id === action.payload.repo.id ? action.payload.repo : r)),
        loadingState: { type: "idle" },
      };

    case "FETCH_REPO_FAILURE":
      return {
        ...state,
        loadingState: { type: "idle" },
        error: action.payload.error,
      };

    // 刷新全部
    case "REFRESH_ALL_START":
      return {
        ...state,
        loadingState: { type: "refreshing", repoIds: action.payload.repoIds },
        error: null,
      };

    case "REFRESH_ALL_SUCCESS":
      return {
        ...state,
        repos: action.payload.repos,
        loadingState: { type: "idle" },
      };

    case "REFRESH_ALL_FAILURE":
      return {
        ...state,
        loadingState: { type: "idle" },
        error: action.payload.error,
      };

    // 重新計算相似度
    case "RECALCULATE_START":
      return {
        ...state,
        loadingState: { type: "recalculating" },
      };

    case "RECALCULATE_SUCCESS":
      return {
        ...state,
        loadingState: { type: "idle" },
      };

    case "RECALCULATE_FAILURE":
      return {
        ...state,
        loadingState: { type: "idle" },
        error: action.payload.error,
      };

    // UI 操作
    case "OPEN_DIALOG":
      return {
        ...state,
        ui: {
          ...state.ui,
          dialog: {
            isOpen: true,
            error: null,
          },
        },
      };

    case "CLOSE_DIALOG":
      return {
        ...state,
        ui: {
          ...state.ui,
          dialog: {
            isOpen: false,
            error: null,
          },
        },
      };

    case "CLEAR_DIALOG_ERROR":
      return {
        ...state,
        ui: {
          ...state.ui,
          dialog: {
            ...state.ui.dialog,
            error: null,
          },
        },
      };

    case "OPEN_REMOVE_CONFIRM":
      return {
        ...state,
        ui: {
          ...state.ui,
          removeConfirm: {
            isOpen: true,
            repoId: action.payload.repoId,
            repoName: action.payload.repoName,
          },
        },
      };

    case "CLOSE_REMOVE_CONFIRM":
      return {
        ...state,
        ui: {
          ...state.ui,
          removeConfirm: {
            isOpen: false,
            repoId: null,
            repoName: "",
          },
        },
      };

    // 篩選操作
    case "SET_CATEGORY":
      return {
        ...state,
        filters: {
          ...state.filters,
          selectedCategoryId: action.payload.categoryId,
        },
      };

    case "SET_SEARCH_QUERY":
      return {
        ...state,
        filters: {
          ...state.filters,
          searchQuery: action.payload.query,
        },
      };

    // Toast 操作
    case "SHOW_TOAST":
      return {
        ...state,
        toasts: [...state.toasts, action.payload],
      };

    case "DISMISS_TOAST":
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.payload.id),
      };

    // 錯誤處理
    case "CLEAR_ERROR":
      return {
        ...state,
        error: null,
      };

    default:
      return state;
  }
}

// ============================================================================
// Contexts
// ============================================================================

const WatchlistStateContext = createContext<WatchlistState | undefined>(undefined);

const WatchlistDispatchContext = createContext<Dispatch<WatchlistAction> | undefined>(undefined);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actions - 使用 useMemo 確保穩定引用
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
        const repoIds = state.repos.map((r) => r.id);
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
        const { repoId } = state.ui.removeConfirm;
        if (repoId === null) return;

        try {
          await actions.removeRepo(repoId);
          actions.success(t.toast.repoRemoved);
        } catch {
          // Error already handled in removeRepo
        }
      },

      cancelRemove: () => dispatch({ type: "CLOSE_REMOVE_CONFIRM" }),

      // 篩選操作
      setCategory: (categoryId: number | null) =>
        dispatch({ type: "SET_CATEGORY", payload: { categoryId } }),

      setSearchQuery: (query: string) => dispatch({ type: "SET_SEARCH_QUERY", payload: { query } }),

      // Toast 操作
      showToast: (type: ToastMessage["type"], message: string) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        dispatch({
          type: "SHOW_TOAST",
          payload: { id, type, message },
        });
      },

      dismissToast: (id: string) => dispatch({ type: "DISMISS_TOAST", payload: { id } }),

      success: (message: string) => actions.showToast("success", message),
      error: (message: string) => actions.showToast("error", message),
      info: (message: string) => actions.showToast("info", message),
      warning: (message: string) => actions.showToast("warning", message),

      // 錯誤處理
      clearError: () => dispatch({ type: "CLEAR_ERROR" }),

      // 連線重試
      retry: async () => {
        dispatch({ type: "INITIALIZE_START" });
        dispatch({ type: "CLEAR_ERROR" });

        try {
          const healthResponse = await checkHealth();
          const isConnected = healthResponse.status === "healthy";
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
    [state.repos, state.ui.removeConfirm, t]
  );

  return (
    <WatchlistStateContext.Provider value={state}>
      <WatchlistDispatchContext.Provider value={dispatch}>
        <WatchlistActionsContext.Provider value={actions}>
          {children}
        </WatchlistActionsContext.Provider>
      </WatchlistDispatchContext.Provider>
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

export function useWatchlistDispatch(): Dispatch<WatchlistAction> {
  const context = useContext(WatchlistDispatchContext);
  if (context === undefined) {
    throw new Error("useWatchlistDispatch must be used within WatchlistProvider");
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
