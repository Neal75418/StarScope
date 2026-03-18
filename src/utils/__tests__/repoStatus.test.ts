import { describe, it, expect } from "vitest";
import { isHotRepo, isStaleRepo, hasActiveSignals } from "../repoStatus";
import type { RepoWithSignals, EarlySignal } from "../../api/client";

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "test",
    name: "repo",
    full_name: "test/repo",
    url: "https://github.com/test/repo",
    description: null,
    language: null,
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    stars: 100,
    forks: 10,
    stars_delta_7d: null,
    stars_delta_30d: null,
    velocity: null,
    acceleration: null,
    trend: null,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    last_fetched: new Date().toISOString(),
    ...overrides,
  };
}

describe("isHotRepo", () => {
  it("returns true when velocity > 50", () => {
    expect(isHotRepo(makeRepo({ velocity: 51 }))).toBe(true);
  });

  it("returns false when velocity <= 50", () => {
    expect(isHotRepo(makeRepo({ velocity: 50 }))).toBe(false);
  });

  it("returns false when velocity is null", () => {
    expect(isHotRepo(makeRepo({ velocity: null }))).toBe(false);
  });
});

describe("isStaleRepo", () => {
  it("returns true when last_fetched is null", () => {
    expect(isStaleRepo(makeRepo({ last_fetched: null }))).toBe(true);
  });

  it("returns true when last_fetched > 30 days ago", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleRepo(makeRepo({ last_fetched: old }))).toBe(true);
  });

  it("returns false when last_fetched < 30 days ago", () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleRepo(makeRepo({ last_fetched: recent }))).toBe(false);
  });
});

describe("hasActiveSignals", () => {
  it("returns true when there are unacknowledged signals", () => {
    const signals = [{ acknowledged: false }] as EarlySignal[];
    expect(hasActiveSignals(signals)).toBe(true);
  });

  it("returns false when all signals are acknowledged", () => {
    const signals = [{ acknowledged: true }] as EarlySignal[];
    expect(hasActiveSignals(signals)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasActiveSignals([])).toBe(false);
  });
});
