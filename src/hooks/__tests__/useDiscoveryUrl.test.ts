import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _serializeToHash, _deserializeFromHash } from "../useDiscoveryUrl";

describe("useDiscoveryUrl helpers", () => {
  describe("serializeToHash", () => {
    it("returns empty string when no state", () => {
      expect(_serializeToHash("", undefined, {})).toBe("");
    });

    it("serializes keyword", () => {
      const hash = _serializeToHash("react", undefined, {});
      expect(hash).toBe("#q=react");
    });

    it("serializes period", () => {
      const hash = _serializeToHash("", "weekly", {});
      expect(hash).toBe("#period=weekly");
    });

    it("serializes keyword + period", () => {
      const hash = _serializeToHash("react", "daily", {});
      expect(hash).toContain("q=react");
      expect(hash).toContain("period=daily");
    });

    it("serializes all filter fields", () => {
      const hash = _serializeToHash("", undefined, {
        language: "TypeScript",
        topic: "machine-learning",
        minStars: 100,
        maxStars: 5000,
        sort: "stars",
        order: "desc",
        license: "mit",
        hideArchived: true,
      });
      expect(hash).toContain("lang=TypeScript");
      expect(hash).toContain("topic=machine-learning");
      expect(hash).toContain("minStars=100");
      expect(hash).toContain("maxStars=5000");
      expect(hash).toContain("sort=stars");
      expect(hash).toContain("order=desc");
      expect(hash).toContain("license=mit");
      expect(hash).toContain("hideArchived=true");
    });

    it("skips falsy filter values", () => {
      const hash = _serializeToHash("", undefined, {
        language: undefined,
        minStars: 0,
        hideArchived: false,
      });
      expect(hash).toBe("");
    });
  });

  describe("deserializeFromHash", () => {
    it("returns null for empty hash", () => {
      expect(_deserializeFromHash("")).toBeNull();
      expect(_deserializeFromHash("#")).toBeNull();
    });

    it("parses keyword", () => {
      const result = _deserializeFromHash("#q=react");
      expect(result).toEqual({
        keyword: "react",
        period: undefined,
        filters: {},
      });
    });

    it("parses period", () => {
      const result = _deserializeFromHash("#period=weekly");
      expect(result?.period).toBe("weekly");
    });

    it("ignores invalid period", () => {
      const result = _deserializeFromHash("#period=yearly");
      expect(result?.period).toBeUndefined();
    });

    it("parses all filter fields", () => {
      const hash =
        "#lang=TypeScript&topic=ai&minStars=100&maxStars=5000&sort=forks&order=asc&license=mit&hideArchived=true";
      const result = _deserializeFromHash(hash);
      expect(result?.filters).toEqual({
        language: "TypeScript",
        topic: "ai",
        minStars: 100,
        maxStars: 5000,
        sort: "forks",
        order: "asc",
        license: "mit",
        hideArchived: true,
      });
    });

    it("ignores invalid sort/order values", () => {
      const result = _deserializeFromHash("#sort=invalid&order=invalid");
      expect(result?.filters.sort).toBeUndefined();
      expect(result?.filters.order).toBeUndefined();
    });

    it("ignores invalid minStars/maxStars", () => {
      const result = _deserializeFromHash("#minStars=abc&maxStars=-1");
      expect(result?.filters.minStars).toBeUndefined();
      expect(result?.filters.maxStars).toBeUndefined();
    });

    it("round-trips serialization", () => {
      const keyword = "react hooks";
      const period = "monthly" as const;
      const filters = {
        language: "TypeScript",
        topic: "web",
        minStars: 50,
        sort: "stars" as const,
        order: "desc" as const,
        license: "apache-2.0",
        hideArchived: true,
      };

      const hash = _serializeToHash(keyword, period, filters);
      const result = _deserializeFromHash(hash);

      expect(result?.keyword).toBe(keyword);
      expect(result?.period).toBe(period);
      expect(result?.filters.language).toBe(filters.language);
      expect(result?.filters.topic).toBe(filters.topic);
      expect(result?.filters.minStars).toBe(filters.minStars);
      expect(result?.filters.sort).toBe(filters.sort);
      expect(result?.filters.order).toBe(filters.order);
      expect(result?.filters.license).toBe(filters.license);
      expect(result?.filters.hideArchived).toBe(filters.hideArchived);
    });
  });
});

describe("useDiscoveryUrl integration", () => {
  let originalHash: string;

  beforeEach(() => {
    originalHash = window.location.hash;
  });

  afterEach(() => {
    // 恢復原始 hash
    window.history.replaceState(null, "", originalHash || window.location.pathname);
  });

  it("detects URL params on mount", async () => {
    window.history.replaceState(null, "", "#q=react&period=weekly");

    // 動態 import 以便在 hash 設置後載入
    const { renderHook } = await import("@testing-library/react");
    const { useDiscoveryUrl } = await import("../useDiscoveryUrl");

    const onRestoreState = vi.fn();
    const { result } = renderHook(() =>
      useDiscoveryUrl({
        keyword: "",
        period: undefined,
        filters: {},
        hasSearched: false,
        onRestoreState,
      })
    );

    expect(result.current.hasUrlParams).toBe(true);
    expect(onRestoreState).toHaveBeenCalledWith({
      keyword: "react",
      period: "weekly",
      filters: {},
    });
  });
});
