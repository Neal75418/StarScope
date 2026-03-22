/**
 * 批次操作列：固定底部，顯示批次加入分類、刷新、移除操作。
 */

import { useState, useCallback, useMemo, useRef, memo } from "react";
import { useI18n, interpolate } from "../../i18n";
import { useCategoryTree } from "../../hooks/useCategoryTree";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface BatchActionBarProps {
  selectedCount: number;
  isProcessing: boolean;
  onBatchAddToCategory: (categoryId: number) => Promise<unknown>;
  onBatchRefresh: () => Promise<unknown>;
  onBatchRemove: () => Promise<unknown>;
  onDone: () => void;
}

export const BatchActionBar = memo(function BatchActionBar({
  selectedCount,
  isProcessing,
  onBatchAddToCategory,
  onBatchRefresh,
  onBatchRemove,
  onDone,
}: BatchActionBarProps) {
  const { t } = useI18n();
  const { tree } = useCategoryTree();
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const closePicker = useCallback(() => setShowCategoryPicker(false), []);
  useClickOutside(pickerRef, closePicker, showCategoryPicker);
  useEscapeKey(closePicker, showCategoryPicker);

  const handleAddToCategory = useCallback(
    async (categoryId: number) => {
      setShowCategoryPicker(false);
      await onBatchAddToCategory(categoryId);
      onDone();
    },
    [onBatchAddToCategory, onDone]
  );

  const handleRefresh = useCallback(async () => {
    await onBatchRefresh();
    onDone();
  }, [onBatchRefresh, onDone]);

  const handleRemove = useCallback(async () => {
    const confirmed = window.confirm(
      interpolate(t.watchlist.batch.confirmRemove, { count: selectedCount })
    );
    if (!confirmed) return;
    await onBatchRemove();
    onDone();
  }, [onBatchRemove, onDone, t, selectedCount]);

  // 攤平所有分類（包含子分類），memoize 避免每次 render 重建
  const flatCategories = useMemo(() => {
    const result: { id: number; name: string; depth: number }[] = [];
    function flatten(nodes: typeof tree, depth: number) {
      for (const node of nodes) {
        result.push({ id: node.id, name: node.name, depth });
        if (node.children?.length) flatten(node.children, depth + 1);
      }
    }
    flatten(tree, 0);
    return result;
  }, [tree]);

  if (selectedCount === 0) return null;

  return (
    <div className="batch-action-bar" data-testid="batch-action-bar">
      <span className="batch-count">
        {interpolate(t.watchlist.batch.selected, { count: selectedCount })}
      </span>

      <div className="batch-actions">
        <div className="batch-category-wrapper" ref={pickerRef}>
          <button
            className="btn btn-sm"
            onClick={() => setShowCategoryPicker((prev) => !prev)}
            disabled={isProcessing || flatCategories.length === 0}
            data-testid="batch-add-to-category"
            aria-expanded={showCategoryPicker}
            aria-haspopup="listbox"
          >
            {t.watchlist.batch.addToCategory}
          </button>
          {showCategoryPicker && (
            <div
              className="batch-category-picker"
              role="listbox"
              data-testid="batch-category-picker"
            >
              {flatCategories.map((cat) => (
                <button
                  key={cat.id}
                  role="option"
                  aria-selected={false}
                  className="batch-category-option"
                  style={{ paddingLeft: `${8 + cat.depth * 16}px` }}
                  onClick={() => handleAddToCategory(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="btn btn-sm"
          onClick={handleRefresh}
          disabled={isProcessing}
          data-testid="batch-refresh"
        >
          {isProcessing ? t.watchlist.batch.processing : t.watchlist.batch.refresh}
        </button>

        <button
          className="btn btn-sm btn-danger"
          onClick={handleRemove}
          disabled={isProcessing}
          data-testid="batch-remove"
        >
          {t.watchlist.batch.remove}
        </button>
      </div>
    </div>
  );
});
