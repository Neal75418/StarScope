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
      const readIds = new Set<string>();

      const result = alertsToNotifications(alerts, readIds);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("alert-1");
      expect(result[0].type).toBe("alert");
      expect(result[0].title).toBe("Star spike");
      expect(result[0].metadata?.alertId).toBe(1);
    });

    it("marks notifications as read when in readIds set", () => {
      const alerts = [makeAlert({ id: 1 })];
      const readIds = new Set(["alert-1"]);

      const result = alertsToNotifications(alerts, readIds);

      expect(result[0].read).toBe(true);
    });

    it("marks notifications as read when acknowledged", () => {
      const alerts = [makeAlert({ id: 1, acknowledged_at: "2024-01-21T00:00:00Z" })];
      const readIds = new Set<string>();

      const result = alertsToNotifications(alerts, readIds);

      expect(result[0].read).toBe(true);
    });

    it("marks notifications as unread when not in readIds and not acknowledged", () => {
      const alerts = [makeAlert({ id: 1, acknowledged_at: null })];
      const readIds = new Set<string>();

      const result = alertsToNotifications(alerts, readIds);

      expect(result[0].read).toBe(false);
    });

    it("includes correct link and metadata", () => {
      const alerts = [makeAlert({ id: 5, repo_name: "vuejs/vue", signal_type: "velocity" })];
      const result = alertsToNotifications(alerts, new Set());

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
    it("preserves local read state from existing notifications", () => {
      const newNotifications = [
        makeNotification({ id: "n1", read: false }),
        makeNotification({ id: "n2", read: false }),
      ];
      const existingNotifications = [
        makeNotification({ id: "n1", read: true }), // locally marked as read
        makeNotification({ id: "n2", read: false }),
      ];

      const merged = mergeNotifications(newNotifications, existingNotifications);

      expect(merged[0].read).toBe(true); // preserved from existing
      expect(merged[1].read).toBe(false);
    });

    it("keeps server-side read state", () => {
      const newNotifications = [
        makeNotification({ id: "n1", read: true }), // server says read
      ];
      const existingNotifications = [
        makeNotification({ id: "n1", read: false }), // locally not read
      ];

      const merged = mergeNotifications(newNotifications, existingNotifications);

      expect(merged[0].read).toBe(true); // server says true
    });
  });
});
