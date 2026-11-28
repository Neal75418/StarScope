import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  queryKeys,
  queryClient,
  createTestQueryClient,
  invalidateTrackedRepos,
  invalidateTriggeredAlerts,
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
      // 分類的數量不算封存的 repo：放在 repos 底下，任何重取 repo 清單的入口都會一起重讀
      expect(queryKeys.repos.categoryTree()).toEqual(["repos", "categories", "tree"]);
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
      // 訊號也不算封存的 repo：設定頁復原、探索頁加入之後「有訊號」要跟著變
      queryKeys.signals.summary(),
      queryKeys.alertRuleData.rules(),
      queryKeys.alerts.rules(),
      // 封存 repo 的警報不列、永久刪除連帶刪掉：鈴鐺與儀表板的已觸發警報也要跟著變
      queryKeys.notifications.polling(),
      queryKeys.alerts.triggered(),
      // 批次失敗、卡片改走自己抓時用的是卡片自己的查詢：不失效的話背景更新後徽章停在舊值
      queryKeys.repoCard.badges(1),
      queryKeys.repoCard.signals(1),
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
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("leaves the sync status alone when asked, and reads it again by default", () => {
    // 偵測背景變化的那支靠同步狀態發現變化：跟著重讀會讀到收集器還在寫的新值、又觸發一次
    const fresh = () => {
      const client = new QueryClient();
      client.setQueryData(queryKeys.repos.lists(), []);
      client.setQueryData(queryKeys.repos.syncStatus(), {});
      return client;
    };
    const invalidated = (client: QueryClient) =>
      [queryKeys.repos.lists(), queryKeys.repos.syncStatus()].map(
        (key) => client.getQueryState(key)?.isInvalidated
      );

    const byDefault = fresh();
    invalidateTrackedRepos(byDefault);
    expect(invalidated(byDefault)).toEqual([true, true]);

    const exceptSync = fresh();
    invalidateTrackedRepos(exceptSync, { exceptSyncStatus: true });
    expect(invalidated(exceptSync)).toEqual([true, false]);
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
    // 有人在看（跟 Watchlist 的側欄一樣），invalidate 才會重抓
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.repos.categoryTree(),
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    invalidateTrackedRepos(client);
    resolveFirst([3]);

    await vi.waitFor(() =>
      expect(client.getQueryData(queryKeys.repos.categoryTree())).toEqual([3, 7])
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

describe("invalidateTriggeredAlerts", () => {
  it("reads both caches of the triggered alerts again: the bell and the dashboard", async () => {
    const client = new QueryClient();
    const keys = [
      queryKeys.notifications.polling(),
      queryKeys.alerts.triggered(),
      queryKeys.alerts.rules(),
    ];
    for (const key of keys) client.setQueryData(key, []);

    await invalidateTriggeredAlerts(client);

    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("resolves only after both reads are back", async () => {
    // 回傳的 Promise 代表重讀結束（通知中心的 refresh 就是它）：只等其中一份的話，另一份還在讀就 resolve
    const client = new QueryClient();
    const finish: Record<string, () => void> = {};
    for (const [name, key] of [
      ["bell", queryKeys.notifications.polling()],
      ["dashboard", queryKeys.alerts.triggered()],
    ] as const) {
      let calls = 0;
      const observer = new QueryObserver(client, {
        queryKey: key,
        queryFn: () =>
          calls++ === 0
            ? Promise.resolve([])
            : new Promise<never[]>((resolve) => {
                finish[name] = () => resolve([]);
              }),
      });
      observer.subscribe(() => {});
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    }

    let done = false;
    const pending = invalidateTriggeredAlerts(client).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(Object.keys(finish)).toHaveLength(2));
    finish.bell();
    // 等一個 macrotask：只等鈴鐺的話，resolve 要跳好幾個 microtask 才傳到 done
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    finish.dashboard();
    await pending;
    expect(done).toBe(true);
    client.clear();
  });
});
