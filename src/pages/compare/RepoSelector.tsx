/**
 * Compare 頁面的 Repo 選擇器元件，可搜尋並多選 watchlist 中的 repo。
 */

import { useState, useMemo, memo, useImperativeHandle, forwardRef } from "react";
import type { Ref } from "react";
import { useI18n, interpolate } from "../../i18n";
import type { RepoWithSignals } from "../../api/types";
import { normalizeRepoName } from "../../utils/format";

export const MAX_COMPARE_REPOS = 5;

export interface RepoSelectorHandle {
  resetSearch: () => void;
}

// Repo 選擇器
export const RepoSelector = memo(
  forwardRef(function RepoSelector(
    {
      repos,
      selectedIds,
      onToggle,
      onGoDiscover,
      t,
    }: {
      repos: RepoWithSignals[];
      selectedIds: number[];
      onToggle: (id: number) => void;
      onGoDiscover: () => void;
      t: ReturnType<typeof useI18n>["t"];
    },
    ref: Ref<RepoSelectorHandle>
  ) {
    const [search, setSearch] = useState("");

    useImperativeHandle(
      ref,
      () => ({
        resetSearch: () => setSearch(""),
      }),
      []
    );

    const atLimit = selectedIds.length >= MAX_COMPARE_REPOS;

    const filtered = useMemo(() => {
      if (!search.trim()) return repos;
      const q = search.toLowerCase();
      return repos.filter((r) => normalizeRepoName(r.full_name).includes(q));
    }, [repos, search]);

    // 追蹤數 < 2 時對比在數學上不可能：不渲染搜尋框（搜空集合）與
    // 「至少選擇 2 個」（不可能完成的指令），換成原因說明＋出口
    if (repos.length < 2) {
      return (
        <div className="compare-selector" data-testid="compare-need-repos">
          <h3>{t.compare.selectRepos}</h3>
          <p className="compare-hint">
            {interpolate(t.compare.needMoreRepos, { count: repos.length })}
          </p>
          <button
            className="btn btn-primary empty-state-cta"
            data-testid="compare-go-discover"
            onClick={onGoDiscover}
          >
            {t.common.goDiscover}
          </button>
        </div>
      );
    }

    return (
      <div className="compare-selector">
        <h3>{t.compare.selectRepos}</h3>
        <input
          type="text"
          className="compare-search"
          placeholder={t.compare.searchPlaceholder}
          aria-label={t.compare.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {atLimit && (
          <p className="compare-hint" role="status">
            {t.compare.maxRepos}
          </p>
        )}
        <div className="compare-repo-list">
          {filtered.length === 0 && (
            <p className="compare-hint" role="status">
              {t.compare.noMatch}
            </p>
          )}
          {filtered.map((repo) => {
            const isSelected = selectedIds.includes(repo.id);
            const isDisabled = !isSelected && atLimit;
            return (
              <button
                key={repo.id}
                className={`compare-repo-chip ${isSelected ? "selected" : ""}${isDisabled ? " disabled" : ""}`}
                onClick={() => onToggle(repo.id)}
                disabled={isDisabled}
                title={repo.full_name}
              >
                {repo.full_name}
                {isSelected && <span className="compare-chip-x">×</span>}
              </button>
            );
          })}
        </div>
        {selectedIds.length < 2 && <p className="compare-hint">{t.compare.minRepos}</p>}
      </div>
    );
  })
);
