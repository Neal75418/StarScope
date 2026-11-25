import { describe, it, expect } from "vitest";
import {
  alertsToNotifications,
  sortNotifications,
  mergeNotifications,
} from "../notificationHelpers";
import { TriggeredAlert, AlertOperator } from "../../api/client";
import { Notification } from "../../hooks/useNotifications";

function makeAlert(overrides: Partial<TriggeredAlert> = {}): TriggeredAlert {
  return {
    id: 1,
    rule_id: 1,
    rule_name: "Star spike",
    repo_id: 1,
    repo_name: "facebook/react",
    signal_type: "velocity",
    signal_value: 50.0,
    threshold: 30,
    operator: ">" as AlertOperator,
    triggered_at: "2024-01-20T00:00:00Z",
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "alert-1",
    type: "alert",
    title: "Star spike",
    message: "test message",
    timestamp: "2024-01-20T00:00:00Z",
    read: false,
    ...overrides,
  };
}

describe("notificationHelpers", () => {
  describe("alertsToNotifications", () => {
    it("converts alerts to notifications", () => {
      const alerts = [makeAlert({ id: 1 }), makeAlert({ id: 2 })];

      const result = alertsToNotifications(alerts);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("alert-1-2024-01-20T00:00:00Z");
      expect(result[0].type).toBe("alert");
      expect(result[0].title).toBe("Star spike");
      expect(result[0].metadata?.alertId).toBe(1);
      expect(result[0].metadata?.triggeredAt).toBe("2024-01-20T00:00:00Z");
    });

    it("tells apart two alerts that share an id but were triggered at different times", () => {
      // 觸發紀錄的 id 會重用：舊的那則刪掉後，新警報拿到同一個 id
      const old = alertsToNotifications([
        makeAlert({ id: 1, triggered_at: "2024-01-20T00:00:00Z" }),
      ]);
      const reused = alertsToNotifications([
        makeAlert({ id: 1, triggered_at: "2024-01-21T00:00:00Z" }),
      ]);

      expect(reused[0].id).not.toBe(old[0].id);
    });

    it("marks notifications as read only when the server acknowledged them", () => {
      const result = alertsToNotifications([
        makeAlert({ id: 1, acknowledged: true, acknowledged_at: "2024-01-20T01:00:00Z" }),
        makeAlert({ id: 2 }),
      ]);

      expect(result.map((n) => n.read)).toEqual([true, false]);
    });

    it("includes correct link and metadata", () => {
      const alerts = [makeAlert({ id: 5, repo_name: "vuejs/vue", signal_type: "velocity" })];
      const result = alertsToNotifications(alerts);

      expect(result[0].link).toEqual({ page: "watchlist", params: { repo: "vuejs/vue" } });
      expect(result[0].metadata?.repoName).toBe("vuejs/vue");
      expect(result[0].metadata?.signalType).toBe("velocity");
    });
  });

  describe("sortNotifications", () => {
    it("sorts notifications newest first", () => {
      const notifications = [
        makeNotification({ id: "n1", timestamp: "2024-01-01T00:00:00Z" }),
        makeNotification({ id: "n3", timestamp: "2024-01-03T00:00:00Z" }),
        makeNotification({ id: "n2", timestamp: "2024-01-02T00:00:00Z" }),
      ];

      const sorted = sortNotifications(notifications);

      expect(sorted.map((n) => n.id)).toEqual(["n3", "n2", "n1"]);
    });
  });

  describe("mergeNotifications", () => {
    it("shows read what was marked read in this session", () => {
      const fromServer = [
        makeNotification({ id: "n1", read: false }),
        makeNotification({ id: "n2", read: false }),
      ];

      const merged = mergeNotifications(fromServer, new Set(["n1"]));

      expect(merged.map((n) => n.read)).toEqual([true, false]);
    });

    it("keeps server-side read state", () => {
      const merged = mergeNotifications([makeNotification({ id: "n1", read: true })], new Set());

      expect(merged[0].read).toBe(true);
    });

    it("shows what the server says for what was not marked read in this session", () => {
      // 不沿用畫面上原本的已讀：標已讀失敗（已從 markedReads 拿掉）後讀回來的未讀要照實顯示
      const merged = mergeNotifications([makeNotification({ id: "n1", read: false })], new Set());

      expect(merged[0].read).toBe(false);
    });
  });
});
