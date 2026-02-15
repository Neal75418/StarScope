/**
 * 已儲存篩選條件的下拉選單，快速套用篩選預設。
 */

import type React from "react";
import { useState, useCallback, useRef, useEffect, memo } from "react";
import { useI18n } from "../../i18n";
import { useSavedFilters, SavedFilter } from "../../hooks/useSavedFilters";
import { SearchFilters } from "../../api/client";
import { ChevronDownIcon, XIcon, CheckIcon, StarIcon } from "../Icons";
import styles from "./Discovery.module.css";
import { TrendingPeriod } from "./TrendingFilters";

interface SavedFiltersProps {
  currentQuery: string;
  currentPeriod: TrendingPeriod | undefined;
  currentFilters: SearchFilters;
  onApply: (query: string, period: TrendingPeriod | undefined, filters: SearchFilters) => void;
}

const FilterItem = memo(
  ({
    filter,
    onApply,
    onDelete,
  }: {
    filter: SavedFilter;
    onApply: () => void;
    onDelete: () => void;
  }) => {
    const { t } = useI18n();

    const handleDelete = (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete();
    };

    const getFilterSummary = () => {
      const parts: string[] = [];
      if (filter.query) parts.push(`"${filter.query}"`);
      if (filter.period) parts.push(filter.period);
      if (filter.filters.language) parts.push(filter.filters.language);
      return parts.length > 0 ? parts.join(" • ") : t.savedFilters.noFilters;
    };

    return (
      <div
        className={styles.savedFilterItem}
        onClick={onApply}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onApply();
          }
        }}
      >
        <div className={styles.savedFilterContent}>
          <div className={styles.savedFilterName}>{filter.name}</div>
          <div className={styles.savedFilterSummary}>{getFilterSummary()}</div>
        </div>
        <button
          className={styles.savedFilterDelete}
          onClick={handleDelete}
          aria-label={t.common.delete}
          title={t.common.delete}
        >
          <XIcon size={14} />
        </button>
      </div>
    );
  }
);
FilterItem.displayName = "FilterItem";

export function SavedFilters({
  currentQuery,
  currentPeriod,
  currentFilters,
  onApply,
}: SavedFiltersProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { savedFilters, saveFilter, deleteFilter, hasFilters } = useSavedFilters();

  // 檢查是否有可儲存的啟用篩選
  const hasActiveFilters =
    currentQuery.trim() !== "" ||
    currentPeriod !== undefined ||
    Object.keys(currentFilters).some(
      (key) => currentFilters[key as keyof SearchFilters] !== undefined
    );

  // 點擊外部時關閉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsSaving(false);
        setNewName("");
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // 進入儲存模式時自動聚焦輸入框
  useEffect(() => {
    if (isSaving && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isSaving]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
    if (isOpen) {
      setIsSaving(false);
      setNewName("");
    }
  }, [isOpen]);

  const handleStartSave = useCallback(() => {
    setIsSaving(true);
  }, []);

  const handleCancelSave = useCallback(() => {
    setIsSaving(false);
    setNewName("");
  }, []);

  const handleSave = useCallback(() => {
    if (hasActiveFilters) {
      saveFilter(newName, currentQuery, currentPeriod, currentFilters);
      setIsSaving(false);
      setNewName("");
    }
  }, [newName, currentQuery, currentPeriod, currentFilters, hasActiveFilters, saveFilter]);

  const handleApplyFilter = useCallback(
    (filter: SavedFilter) => {
      onApply(filter.query, filter.period as TrendingPeriod | undefined, filter.filters);
      setIsOpen(false);
    },
    [onApply]
  );

  const handleDeleteFilter = useCallback(
    (filterId: string) => {
      deleteFilter(filterId);
    },
    [deleteFilter]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        handleCancelSave();
      }
    },
    [handleSave, handleCancelSave]
  );

  return (
    <div className={styles.savedFilters} ref={dropdownRef}>
      <button
        className={styles.savedFiltersTrigger}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={t.savedFilters.title}
      >
        <StarIcon size={14} />
        <span>{t.savedFilters.title}</span>
        <ChevronDownIcon size={14} className={isOpen ? styles.rotated : ""} />
        {hasFilters && <span className={styles.savedFiltersCount}>{savedFilters.length}</span>}
      </button>

      {isOpen && (
        <div className={styles.savedFiltersDropdown} role="menu">
          {/* 儲存目前篩選條件 */}
          {hasActiveFilters && (
            <div className={styles.savedFiltersSaveSection}>
              {isSaving ? (
                <div className={styles.savedFiltersSaveForm}>
                  <input
                    ref={inputRef}
                    type="text"
                    className={styles.savedFiltersNameInput}
                    placeholder={t.savedFilters.namePlaceholder}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={50}
                    aria-label={t.savedFilters.namePlaceholder}
                  />
                  <div className={styles.savedFiltersSaveActions}>
                    <button
                      className="btn btn-small btn-primary"
                      onClick={handleSave}
                      aria-label={t.common.save}
                    >
                      <CheckIcon size={14} />
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={handleCancelSave}
                      aria-label={t.common.cancel}
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button className={styles.savedFiltersSaveBtn} onClick={handleStartSave}>
                  {t.savedFilters.saveCurrent}
                </button>
              )}
            </div>
          )}

          {/* 已儲存篩選列表 */}
          <div className={styles.savedFiltersList}>
            {savedFilters.length === 0 ? (
              <div className={styles.savedFiltersEmpty}>{t.savedFilters.empty}</div>
            ) : (
              savedFilters.map((filter) => (
                <FilterItem
                  key={filter.id}
                  filter={filter}
                  onApply={() => handleApplyFilter(filter)}
                  onDelete={() => handleDeleteFilter(filter.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
