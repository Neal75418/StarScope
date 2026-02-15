import { describe, it, expect } from "vitest";
import {
  watchlistReducer,
  initialState,
  type WatchlistState,
  type WatchlistAction,
} from "../watchlistReducer";
import type { RepoWithSignals } from "../../api/client";

// 輔助：建立最小 repo 物件
function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    stars: 200000,
    forks: 40000,
    watchers: 6000,
    open_issues: 1000,
    created_at: "2013-05-24",
    added_at: "2024-01-01",
    updated_at: "2024-06-01",
    stars_delta_1d: 100,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 10.5,
    ...overrides,
  } as RepoWithSignals;
}

// 輔助：dispatch 多個 actions 取得最終狀態
function reduce(state: WatchlistState, ...actions: WatchlistAction[]): WatchlistState {
  return actions.reduce((s, a) => watchlistReducer(s, a), state);
}

describe("watchlistReducer", () => {
  // ==================== 初始化 ====================

  describe("initialization", () => {
    it("INITIALIZE_START sets loadingState to initializing and clears error", () => {
      const state = { ...initialState, error: "old error" };
      const next = watchlistReducer(state, { type: "INITIALIZE_START" });
      expect(next.loadingState).toEqual({ type: "initializing" });
      expect(next.error).toBeNull();
    });

    it("INITIALIZE_SUCCESS sets repos and returns to idle", () => {
      const repos = [makeRepo()];
      const state = { ...initialState, loadingState: { type: "initializing" as const } };
      const next = watchlistReducer(state, {
        type: "INITIALIZE_SUCCESS",
        payload: { repos },
      });
      expect(next.repos).toEqual(repos);
      expect(next.loadingState).toEqual({ type: "idle" });
      expect(next.error).toBeNull();
    });

    it("INITIALIZE_FAILURE sets error and returns to idle", () => {
      const next = watchlistReducer(initialState, {
        type: "INITIALIZE_FAILURE",
        payload: { error: "Connection failed" },
      });
      expect(next.error).toBe("Connection failed");
      expect(next.loadingState).toEqual({ type: "idle" });
    });

    it("SET_CONNECTION_STATUS updates isConnected", () => {
      const next = watchlistReducer(initialState, {
        type: "SET_CONNECTION_STATUS",
        payload: { isConnected: true },
      });
      expect(next.isConnected).toBe(true);
    });
  });

  // ==================== Repo 操作 ====================

  describe("add repo", () => {
    it("ADD_REPO_START sets loading state and opens dialog", () => {
      const next = watchlistReducer(initialState, {
        type: "ADD_REPO_START",
        payload: { fullName: "facebook/react" },
      });
      expect(next.loadingState).toEqual({ type: "adding", fullName: "facebook/react" });
      expect(next.ui.dialog.isOpen).toBe(true);
      expect(next.ui.dialog.error).toBeNull();
    });

    it("ADD_REPO_SUCCESS inserts repo sorted by full_name and closes dialog", () => {
      const existingRepo = makeRepo({ id: 2, full_name: "vercel/next.js" });
      const state = { ...initialState, repos: [existingRepo] };

      const newRepo = makeRepo({ id: 1, full_name: "facebook/react" });
      const next = watchlistReducer(state, {
        type: "ADD_REPO_SUCCESS",
        payload: { repo: newRepo },
      });

      expect(next.repos).toHaveLength(2);
      expect(next.repos[0].full_name).toBe("facebook/react");
      expect(next.repos[1].full_name).toBe("vercel/next.js");
      expect(next.loadingState).toEqual({ type: "idle" });
      expect(next.ui.dialog.isOpen).toBe(false);
    });

    it("ADD_REPO_FAILURE sets dialog error without closing", () => {
      const state = {
        ...initialState,
        ui: { ...initialState.ui, dialog: { isOpen: true, error: null } },
      };
      const next = watchlistReducer(state, {
        type: "ADD_REPO_FAILURE",
        payload: { error: "Repo not found" },
      });
      expect(next.ui.dialog.isOpen).toBe(true);
      expect(next.ui.dialog.error).toBe("Repo not found");
      expect(next.loadingState).toEqual({ type: "idle" });
    });
  });

  describe("remove repo", () => {
    it("REMOVE_REPO_SUCCESS filters out repo and resets remove confirm", () => {
      const repos = [makeRepo({ id: 1 }), makeRepo({ id: 2, full_name: "vercel/next.js" })];
      const state = {
        ...initialState,
        repos,
        ui: {
          ...initialState.ui,
          removeConfirm: { isOpen: true, repoId: 1, repoName: "facebook/react" },
        },
      };

      const next = watchlistReducer(state, {
        type: "REMOVE_REPO_SUCCESS",
        payload: { repoId: 1 },
      });

      expect(next.repos).toHaveLength(1);
      expect(next.repos[0].id).toBe(2);
      expect(next.ui.removeConfirm.isOpen).toBe(false);
      expect(next.ui.removeConfirm.repoId).toBeNull();
    });

    it("REMOVE_REPO_FAILURE sets top-level error", () => {
      const next = watchlistReducer(initialState, {
        type: "REMOVE_REPO_FAILURE",
        payload: { error: "Delete failed" },
      });
      expect(next.error).toBe("Delete failed");
    });
  });

  describe("fetch repo", () => {
    it("FETCH_REPO_SUCCESS updates existing repo in place", () => {
      const repos = [makeRepo({ id: 1, stars: 100 })];
      const state = { ...initialState, repos };

      const updated = makeRepo({ id: 1, stars: 200 });
      const next = watchlistReducer(state, {
        type: "FETCH_REPO_SUCCESS",
        payload: { repo: updated },
      });

      expect(next.repos[0].stars).toBe(200);
      expect(next.loadingState).toEqual({ type: "idle" });
    });

    it("FETCH_REPO_FAILURE sets error", () => {
      const next = watchlistReducer(initialState, {
        type: "FETCH_REPO_FAILURE",
        payload: { repoId: 1, error: "Fetch error" },
      });
      expect(next.error).toBe("Fetch error");
    });
  });

  // ==================== 批次操作 ====================

  describe("batch operations", () => {
    it("REFRESH_ALL_START sets refreshing with repo IDs", () => {
      const next = watchlistReducer(initialState, {
        type: "REFRESH_ALL_START",
        payload: { repoIds: [1, 2, 3] },
      });
      expect(next.loadingState).toEqual({ type: "refreshing", repoIds: [1, 2, 3] });
      expect(next.error).toBeNull();
    });

    it("REFRESH_ALL_SUCCESS replaces all repos", () => {
      const state = { ...initialState, repos: [makeRepo({ id: 1 })] };
      const newRepos = [makeRepo({ id: 1, stars: 999 }), makeRepo({ id: 2 })];

      const next = watchlistReducer(state, {
        type: "REFRESH_ALL_SUCCESS",
        payload: { repos: newRepos },
      });

      expect(next.repos).toHaveLength(2);
      expect(next.repos[0].stars).toBe(999);
    });

    it("RECALCULATE_START/SUCCESS cycle", () => {
      const s1 = watchlistReducer(initialState, { type: "RECALCULATE_START" });
      expect(s1.loadingState).toEqual({ type: "recalculating" });

      const s2 = watchlistReducer(s1, { type: "RECALCULATE_SUCCESS" });
      expect(s2.loadingState).toEqual({ type: "idle" });
    });

    it("RECALCULATE_FAILURE sets error", () => {
      const next = watchlistReducer(initialState, {
        type: "RECALCULATE_FAILURE",
        payload: { error: "Calc failed" },
      });
      expect(next.error).toBe("Calc failed");
    });
  });

  // ==================== UI 操作 ====================

  describe("UI operations", () => {
    it("OPEN_DIALOG / CLOSE_DIALOG toggles dialog state", () => {
      const opened = watchlistReducer(initialState, { type: "OPEN_DIALOG" });
      expect(opened.ui.dialog.isOpen).toBe(true);

      const closed = watchlistReducer(opened, { type: "CLOSE_DIALOG" });
      expect(closed.ui.dialog.isOpen).toBe(false);
      expect(closed.ui.dialog.error).toBeNull();
    });

    it("CLEAR_DIALOG_ERROR clears only dialog error", () => {
      const state = {
        ...initialState,
        ui: { ...initialState.ui, dialog: { isOpen: true, error: "Some error" } },
      };
      const next = watchlistReducer(state, { type: "CLEAR_DIALOG_ERROR" });
      expect(next.ui.dialog.error).toBeNull();
      expect(next.ui.dialog.isOpen).toBe(true);
    });

    it("OPEN_REMOVE_CONFIRM / CLOSE_REMOVE_CONFIRM toggles confirm state", () => {
      const opened = watchlistReducer(initialState, {
        type: "OPEN_REMOVE_CONFIRM",
        payload: { repoId: 42, repoName: "test/repo" },
      });
      expect(opened.ui.removeConfirm).toEqual({
        isOpen: true,
        repoId: 42,
        repoName: "test/repo",
      });

      const closed = watchlistReducer(opened, { type: "CLOSE_REMOVE_CONFIRM" });
      expect(closed.ui.removeConfirm.isOpen).toBe(false);
      expect(closed.ui.removeConfirm.repoId).toBeNull();
    });
  });

  // ==================== 篩選操作 ====================

  describe("filter operations", () => {
    it("SET_CATEGORY updates selectedCategoryId", () => {
      const next = watchlistReducer(initialState, {
        type: "SET_CATEGORY",
        payload: { categoryId: 5 },
      });
      expect(next.filters.selectedCategoryId).toBe(5);
    });

    it("SET_CATEGORY with null clears category and repo IDs", () => {
      const state = {
        ...initialState,
        filters: { ...initialState.filters, selectedCategoryId: 5, categoryRepoIds: [1, 2] },
      };
      const next = watchlistReducer(state, {
        type: "SET_CATEGORY",
        payload: { categoryId: null },
      });
      expect(next.filters.selectedCategoryId).toBeNull();
      expect(next.filters.categoryRepoIds).toBeNull();
    });

    it("SET_CATEGORY_REPOS updates categoryRepoIds", () => {
      const next = watchlistReducer(initialState, {
        type: "SET_CATEGORY_REPOS",
        payload: { repoIds: [10, 20, 30] },
      });
      expect(next.filters.categoryRepoIds).toEqual([10, 20, 30]);
    });

    it("SET_SEARCH_QUERY updates searchQuery", () => {
      const next = watchlistReducer(initialState, {
        type: "SET_SEARCH_QUERY",
        payload: { query: "react" },
      });
      expect(next.filters.searchQuery).toBe("react");
    });
  });

  // ==================== Toast 操作 ====================

  describe("toast operations", () => {
    it("SHOW_TOAST appends toast", () => {
      const toast = { id: "t1", type: "success" as const, message: "Done!" };
      const next = watchlistReducer(initialState, {
        type: "SHOW_TOAST",
        payload: toast,
      });
      expect(next.toasts).toHaveLength(1);
      expect(next.toasts[0]).toEqual(toast);
    });

    it("DISMISS_TOAST removes specific toast", () => {
      const state = {
        ...initialState,
        toasts: [
          { id: "t1", type: "success" as const, message: "A" },
          { id: "t2", type: "error" as const, message: "B" },
        ],
      };
      const next = watchlistReducer(state, {
        type: "DISMISS_TOAST",
        payload: { id: "t1" },
      });
      expect(next.toasts).toHaveLength(1);
      expect(next.toasts[0].id).toBe("t2");
    });
  });

  // ==================== 錯誤處理 ====================

  describe("error handling", () => {
    it("CLEAR_ERROR clears top-level error", () => {
      const state = { ...initialState, error: "Something went wrong" };
      const next = watchlistReducer(state, { type: "CLEAR_ERROR" });
      expect(next.error).toBeNull();
    });
  });

  // ==================== 邊界情境 ====================

  describe("edge cases", () => {
    it("unknown action returns same state", () => {
      const next = watchlistReducer(initialState, {
        type: "UNKNOWN",
      } as unknown as WatchlistAction);
      expect(next).toBe(initialState);
    });

    it("multiple actions compose correctly", () => {
      const result = reduce(
        initialState,
        { type: "SET_CONNECTION_STATUS", payload: { isConnected: true } },
        { type: "INITIALIZE_SUCCESS", payload: { repos: [makeRepo()] } },
        { type: "SET_SEARCH_QUERY", payload: { query: "react" } }
      );
      expect(result.isConnected).toBe(true);
      expect(result.repos).toHaveLength(1);
      expect(result.filters.searchQuery).toBe("react");
    });
  });
});
