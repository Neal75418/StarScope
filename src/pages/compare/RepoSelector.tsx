import { useState, useMemo, memo } from "react";
import { useI18n } from "../../i18n";
import type { RepoWithSignals } from "../../api/types";

const MAX_COMPARE_REPOS = 5;

// --- RepoSelector ---
export const RepoSelector = memo(function RepoSelector({
  repos,
  selectedIds,
  onToggle,
  t,
}: {
  repos: RepoWithSignals[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [repos, search]);

  return (
    <div className="compare-selector">
      <h3>{t.compare.selectRepos}</h3>
      <input
        type="text"
        className="compare-search"
        placeholder={t.compare.searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="compare-repo-list">
        {filtered.map((repo) => {
          const isSelected = selectedIds.includes(repo.id);
          const disabled = !isSelected && selectedIds.length >= MAX_COMPARE_REPOS;
          return (
            <button
              key={repo.id}
              className={`compare-repo-chip ${isSelected ? "selected" : ""}`}
              onClick={() => onToggle(repo.id)}
              disabled={disabled}
              title={disabled ? t.compare.maxRepos : repo.full_name}
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
});
