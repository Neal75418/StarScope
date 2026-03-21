import { describe, it, expect } from "vitest";
import { queryKeys, queryClient, createTestQueryClient } from "../react-query";

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
    it("generates health key", () => {
      expect(queryKeys.dashboard.health).toEqual(["dashboard", "health"]);
    });

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

    it("generates categories key", () => {
      expect(queryKeys.dashboard.categories()).toEqual(["dashboard", "categories"]);
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
      expect(queryKeys.repos.starred()).toEqual(["repos", "starred"]);
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
