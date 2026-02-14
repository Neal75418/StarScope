/**
 * Watchlist Reducer：型別定義、初始狀態、純函數 reducer。
 */

import type { RepoWithSignals } from "../api/client";
import type { ToastMessage } from "../components/Toast";

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
    categoryRepoIds: number[] | null;
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
  | { type: "SET_CATEGORY_REPOS"; payload: { repoIds: number[] | null } }
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
  setCategory: (categoryId: number | null) => Promise<void>;
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
// Initial State & Reducer
// ============================================================================

export const initialState: WatchlistState = {
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
    categoryRepoIds: null,
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
          categoryRepoIds:
            action.payload.categoryId === null ? null : state.filters.categoryRepoIds,
        },
      };

    case "SET_CATEGORY_REPOS":
      return {
        ...state,
        filters: {
          ...state.filters,
          categoryRepoIds: action.payload.repoIds,
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
