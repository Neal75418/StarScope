import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  queryKeys,
  queryClient,
  createTestQueryClient,
  invalidateTrackedRepos,
} from "../react-query";

describe("queryKeys", () => {
  describe("repos", () => {
    it("generates base key", () => {
      expect(queryKeys.repos.all).toEqual(["repos"]);
    });

    it("generates list key with filters", () => {
      expect(queryKeys.repos.list({ page: 1, perPage: 20 })).toEqual([
        "repos",
        "list",
        { page: 1, perPage: 20 },
      ]);
    });

    it("generates detail key", () => {
      expect(queryKeys.repos.detail(42)).toEqual(["repos", "detail", 42]);
    });

    it("keeps the category views under the repos prefix", () => {
      // 分類的數量與成員都不算封存的 repo：放在 repos 底下，任何重取 repo 清單的入口都會一起重讀
      expect(queryKeys.repos.categoryTree()).toEqual(["repos", "categories", "tree"]);
      expect(queryKeys.repos.categoryMembers(5)).toEqual(["repos", "categories", "members", 5]);
    });
  });

  describe("signals", () => {
    it("generates batch key", () => {
      expect(queryKeys.signals.batch([1, 2, 3])).toEqual(["signals", "batch", [1, 2, 3]]);
    });

    it("generates dashboard key", () => {
      expect(queryKeys.signals.dashboard()).toEqual(["signals", "dashboard"]);
    });

    it("generates summary key", () => {
      expect(queryKeys.signals.summary()).toEqual(["signals", "summary"]);
    });
  });

  describe("contextBadges", () => {
    it("generates batch key", () => {
      expect(queryKeys.contextBadges.batch([10, 20])).toEqual(["contextBadges", "batch", [10, 20]]);
    });
  });

  describe("alerts", () => {
    it("generates rules key", () => {
      expect(queryKeys.alerts.rules()).toEqual(["alerts", "rules"]);
    });

    it("generates triggered key", () => {
      expect(queryKeys.alerts.triggered()).toEqual(["alerts", "triggered"]);
    });

    it("generates signalTypes key", () => {
      expect(queryKeys.alerts.signalTypes()).toEqual(["alerts", "signalTypes"]);
    });
  });

  describe("trends", () => {
    it("generates list key with filters", () => {
      expect(queryKeys.trends.list({ sortBy: "stars", language: "Python" })).toEqual([
        "trends",
        "list",
        { sortBy: "stars", language: "Python" },
      ]);
    });
  });

  describe("discovery", () => {
    it("generates search key with params", () => {
      expect(
        queryKeys.discovery.search({ query: "react", filters: { language: "TypeScript" } })
      ).toEqual(["discovery", "search", { query: "react", filters: { language: "TypeScript" } }]);
    });
  });

  describe("githubAuth", () => {
    it("generates status key", () => {
      expect(queryKeys.githubAuth.status).toEqual(["githubAuth", "status"]);
    });
  });

  describe("dashboard", () => {
    it("generates weeklySummary key", () => {
      expect(queryKeys.dashboard.weeklySummary(7)).toEqual(["dashboard", "weeklySummary", 7]);
    });

    it("generates portfolioHistory key", () => {
      expect(queryKeys.dashboard.portfolioHistory(30)).toEqual([
        "dashboard",
        "portfolioHistory",
        30,
      ]);
    });
  });

  describe("comparison", () => {
    it("generates chart key", () => {
      expect(queryKeys.comparison.chart([1, 2], "30d", false)).toEqual([
        "comparison",
        "chart",
        [1, 2],
        "30d",
        false,
      ]);
    });
  });

  describe("recommendations", () => {
    it("generates personalized key", () => {
      expect(queryKeys.recommendations.personalized(10)).toEqual([
        "recommendations",
        "personalized",
        10,
      ]);
    });
  });

  describe("notifications", () => {
    it("generates polling key", () => {
      expect(queryKeys.notifications.polling()).toEqual(["notifications", "polling"]);
    });
  });

  describe("backfill", () => {
    it("generates status key", () => {
      expect(queryKeys.backfill.status(1)).toEqual(["backfill", "status", 1]);
    });
  });

  describe("connection", () => {
    it("generates status key", () => {
      expect(queryKeys.connection.status()).toEqual(["connection", "status"]);
    });
  });

  describe("starsChart", () => {
    it("generates data key", () => {
      expect(queryKeys.starsChart.data(1, "30d")).toEqual(["starsChart", "data", 1, "30d"]);
    });
  });

  describe("repoCard", () => {
    it("generates badges key", () => {
      expect(queryKeys.repoCard.badges(1)).toEqual(["repoCard", "badges", 1]);
    });

    it("generates signals key", () => {
      expect(queryKeys.repoCard.signals(1)).toEqual(["repoCard", "signals", 1]);
    });
  });

  describe("alertRuleData", () => {
    it("generates rules key", () => {
      expect(queryKeys.alertRuleData.rules()).toEqual(["alertRuleData", "rules"]);
    });

    it("generates signalTypes key", () => {
      expect(queryKeys.alertRuleData.signalTypes()).toEqual(["alertRuleData", "signalTypes"]);
    });

    it("generates repos key", () => {
      expect(queryKeys.alertRuleData.repos()).toEqual(["alertRuleData", "repos"]);
    });
  });

  describe("repos extended", () => {
    it("generates starred key", () => {
      expect(queryKeys.repos.archived()).toEqual(["repos", "archived"]);
    });
  });
});

describe("queryClient", () => {
  it("is a QueryClient instance", () => {
    expect(queryClient).toBeDefined();
    expect(queryClient.getDefaultOptions()).toBeDefined();
  });
});

describe("createTestQueryClient", () => {
  it("creates a QueryClient with no retry", () => {
    const testClient = createTestQueryClient();
    const defaults = testClient.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });
});

describe("invalidateTrackedRepos", () => {
  it("also refreshes both caches of the alert rule list, whose visibility follows the tracked repos", () => {
    // 後端把綁在封存 repo 上的規則當成不存在：清單留著舊資料的話，
    // 切換、編輯、刪除那條規則會 404，復原的 repo 的規則也不會回來
    const client = new QueryClient();
    const keys = [
      queryKeys.repos.lists(),
      queryKeys.repos.categoryTree(),
      queryKeys.repos.categoryMembers(5),
      queryKeys.alertRuleData.rules(),
      queryKeys.alerts.rules(),
      queryKeys.digest.session(),
    ];
    for (const key of keys) client.setQueryData(key, []);

    invalidateTrackedRepos(client);

    // digest 刻意不重取：重抓只回新項目，會蓋掉使用者正在看的這批
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("restarts a category load that is still on its first request", async () => {
    // 那個請求是寫入前讀的：併進它的話，第一次載入會帶回舊資料，而且把這次重讀的標記一起清掉
    const client = new QueryClient();
    let resolveFirst: (v: number[]) => void = () => {};
    const queryFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number[]>((r) => {
            resolveFirst = r;
          })
      )
      .mockResolvedValueOnce([3, 7]);
    // 有人在看（跟 Watchlist 上選著的分類一樣），invalidate 才會重抓
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.repos.categoryMembers(5),
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    invalidateTrackedRepos(client);
    resolveFirst([3]);

    await vi.waitFor(() =>
      expect(client.getQueryData(queryKeys.repos.categoryMembers(5))).toEqual([3, 7])
    );
    unsubscribe();
  });

  it("refetches the category tree even when nothing shows it right now", async () => {
    // 側欄只在 Watchlist 頁掛著：在設定頁或探索頁改了名單，回到 Watchlist 時第一眼不該先看到舊數字
    const client = new QueryClient();
    const queryFn = vi.fn().mockResolvedValue({ tree: [], total: 0 });
    await client.prefetchQuery({ queryKey: queryKeys.repos.categoryTree(), queryFn });

    invalidateTrackedRepos(client);

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });
});
