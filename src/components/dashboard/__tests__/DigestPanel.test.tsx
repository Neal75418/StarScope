/**
 * 這是整頁唯一「你可以不看」的地方：宣稱沒事之前要先確定檢查跑得起來，
 * 失敗時更不能落到「沒事」。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DigestPanel } from "../DigestPanel";
import type { DigestItem, DigestResponse } from "../../../api/client";
import { safeOpenUrl } from "../../../utils/url";

vi.mock("../../../utils/url", () => ({ safeOpenUrl: vi.fn() }));

const repo = { id: 1, full_name: "tauri-apps/tauri", url: "https://github.com/tauri-apps/tauri" };

function item(
  key: string,
  tier: "highlight" | "other",
  over: Partial<DigestItem> = {}
): DigestItem {
  return {
    key,
    tier,
    kind: "release",
    repo,
    occurred_at: new Date().toISOString(),
    url: "https://example.com/" + key,
    title: key,
    tags: [],
    ...over,
  } as DigestItem;
}

function digest(items: DigestItem[], over: Partial<DigestResponse> = {}): DigestResponse {
  return {
    items,
    other_total: items.filter((i) => i.tier === "other").length,
    cursor: { context_signal_id: 1, early_signal_id: 0, triggered_alert_id: 0 },
    last_seen_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    releases_checked: true,
    ...over,
  };
}

const base = {
  isLoading: false,
  isError: false,
  appendFailed: false,
  onRetry: () => {},
  totalRepos: 98,
  hasAlertRules: true,
  updatedLabel: "5m",
  isRefreshing: false,
  onRefresh: () => {},
};

describe("DigestPanel", () => {
  it("while loading it never says nothing happened", () => {
    render(<DigestPanel {...base} digest={undefined} isLoading />);
    expect(screen.getByTestId("digest-panel")).not.toHaveTextContent(/nothing worth/i);
  });

  it("a failed load shows the failure and a retry, not 'nothing'", () => {
    const onRetry = vi.fn();
    render(<DigestPanel {...base} digest={undefined} isError onRetry={onRetry} />);

    const panel = screen.getByTestId("digest-panel");
    expect(panel).toHaveTextContent(/couldn't load/i);
    expect(panel).not.toHaveTextContent(/nothing worth/i);
    fireEvent.click(screen.getByTestId("digest-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("before releases were ever fetched it says it is still checking", () => {
    render(<DigestPanel {...base} digest={digest([], { releases_checked: false })} />);
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/still checking/i);
    expect(screen.getByTestId("digest-panel")).not.toHaveTextContent(/nothing worth/i);
  });

  it("empty: says so, with when you last looked", () => {
    render(<DigestPanel {...base} digest={digest([])} />);
    const panel = screen.getByTestId("digest-panel");
    expect(panel).toHaveTextContent(/nothing worth your attention/i);
    expect(panel).toHaveTextContent(/3d/);
    expect(panel).not.toHaveTextContent(/no alert rules/i);
  });

  it("empty without alert rules says that too", () => {
    render(<DigestPanel {...base} hasAlertRules={false} digest={digest([])} />);
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/no alert rules/i);
  });

  it("highlights are listed; others are collapsed with a count", () => {
    render(
      <DigestPanel
        {...base}
        digest={digest([
          item("release:1", "highlight", { tags: ["security"] } as Partial<DigestItem>),
          item("release:2", "other"),
          item("release:3", "other"),
        ])}
      />
    );

    expect(screen.getAllByTestId("digest-item")).toHaveLength(1);
    const toggle = screen.getByTestId("digest-others-toggle");
    expect(toggle).toHaveTextContent("2");
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("digest-item")).toHaveLength(3);
  });

  it("says how many others were cut off", () => {
    render(
      <DigestPanel {...base} digest={digest([item("release:2", "other")], { other_total: 60 })} />
    );
    fireEvent.click(screen.getByTestId("digest-others-toggle"));
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/59 more/i);
  });

  it("clicking a release opens its page; a signal opens the repo on GitHub", () => {
    render(
      <DigestPanel
        {...base}
        digest={digest([
          item("release:1", "highlight", { tags: ["breaking"] } as Partial<DigestItem>),
          item("signal:1", "highlight", {
            kind: "signal",
            url: null,
            signal: {
              id: 1,
              repo_id: 1,
              repo_name: repo.full_name,
              signal_type: "breakout",
              severity: "high",
              description: "d",
              velocity_value: 30,
              star_count: 1,
              percentile_rank: null,
              baseline_value: 10,
              context_title: null,
              detected_at: "2026-09-25T00:00:00",
              expires_at: null,
              acknowledged: false,
              acknowledged_at: null,
            },
          } as Partial<DigestItem>),
        ])}
      />
    );

    const [release, signal] = screen.getAllByTestId("digest-item");
    fireEvent.click(release.querySelector("a") as HTMLAnchorElement);
    fireEvent.click(signal.querySelector("a") as HTMLAnchorElement);
    expect(safeOpenUrl).toHaveBeenNthCalledWith(1, "https://example.com/release:1");
    expect(safeOpenUrl).toHaveBeenNthCalledWith(2, repo.url);
  });

  it("a failed append is visible", () => {
    render(<DigestPanel {...base} appendFailed digest={digest([])} />);
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/next time/i);
  });

  it("keeps the tracking count, freshness and the refresh button", () => {
    const onRefresh = vi.fn();
    render(<DigestPanel {...base} onRefresh={onRefresh} digest={digest([])} />);
    const panel = screen.getByTestId("digest-panel");
    expect(panel).toHaveTextContent("98");
    expect(panel).toHaveTextContent("5m");
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalled();
  });
});
