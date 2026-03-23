/**
 * 批次操作列：固定底部，顯示批次加入分類、刷新、移除操作。
 */

import { useState, useCallback, useMemo, useRef, memo } from "react";
import { useI18n, interpolate } from "../../i18n";
import { useCategoryTree } from "../../hooks/useCategoryTree";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { ConfirmDialog } from "../../components/ConfirmDialog";

interface BatchResult {
  success: number;
  failed: number;
  total: number;
}

interface DetailedBatchResult extends BatchResult {
  failedIds: number[];
}

interface BatchActionBarProps {
  selectedCount: number;
  isProcessing: boolean;
  onBatchAddToCategory: (categoryId: number) => Promise<DetailedBatchResult>;
  onBatchRefresh: () => Promise<BatchResult>;
  onBatchRemove: () => Promise<DetailedBatchResult>;
  onPruneSelection: (keepIds: number[]) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}

export const BatchActionBar = memo(function BatchActionBar({
  selectedCount,
  isProcessing,
  onBatchAddToCategory,
  onBatchRefresh,
  onBatchRemove,
  onPruneSelection,
  onDone,
  onError,
}: BatchActionBarProps) {
  const { t } = useI18n();
  const { tree } = useCategoryTree();
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const closePicker = useCallback(() => setShowCategoryPicker(false), []);
  useClickOutside(pickerRef, closePicker, showCategoryPicker);
  useEscapeKey(closePicker, showCategoryPicker);

  const handleResult = useCallback(
    (result: BatchResult) => {
      if (result.success === result.total) {
        onDone();
      } else if (result.success > 0) {
        onError(
          interpolate(t.watchlist.batch.partial, {
            success: result.success,
            total: result.total,
          })
        );
      } else {
        onError(t.watchlist.batch.error);
      }
    },
    [onDone, onError, t]
  );

  const handleAddToCategory = useCallback(
    async (categoryId: number) => {
      setShowCategoryPicker(false);
      const result = await onBatchAddToCategory(categoryId);
      if (result.success === result.total) {
        onDone();
      } else if (result.success > 0) {
        onPruneSelection(result.failedIds);
        onError(
          interpolate(t.watchlist.batch.partial, {
            success: result.success,
            total: result.total,
          })
        );
      } else {
        onError(t.watchlist.batch.error);
      }
    },
    [onBatchAddToCategory, onPruneSelection, onDone, onError, t]
  );

  const handleRefresh = useCallback(async () => {
    const result = await onBatchRefresh();
    handleResult(result);
  }, [onBatchRefresh, handleResult]);

  const handleRemoveClick = useCallback(() => setShowRemoveConfirm(true), []);
  const closeRemoveConfirm = useCallback(() => setShowRemoveConfirm(false), []);

  const handleRemoveConfirm = useCallback(async () => {
    setIsRemoving(true);
    try {
      const result = await onBatchRemove();
      if (result.success === result.total) {
        setShowRemoveConfirm(false);
        onDone();
      } else if (result.success > 0) {
        // Partial — close dialog, prune selection to only failed IDs for retry
        setShowRemoveConfirm(false);
        onPruneSelection(result.failedIds);
        onError(
          interpolate(t.watchlist.batch.partial, {
            success: result.success,
            total: result.total,
          })
        );
      } else {
        // Full failure — keep dialog open for retry
        onError(t.watchlist.batch.error);
      }
    } catch {
      // Unexpected error — keep dialog open for retry
      onError(t.watchlist.batch.error);
    } finally {
      setIsRemoving(false);
    }
  }, [onBatchRemove, onPruneSelection, onDone, onError, t]);

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
            aria-haspopup="menu"
          >
            {t.watchlist.batch.addToCategory}
          </button>
          {showCategoryPicker && (
            <div className="batch-category-picker" role="menu" data-testid="batch-category-picker">
              {flatCategories.map((cat) => (
                <button
                  key={cat.id}
                  role="menuitem"
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
          onClick={handleRemoveClick}
          disabled={isProcessing}
          data-testid="batch-remove"
        >
          {t.watchlist.batch.remove}
        </button>
      </div>

      <ConfirmDialog
        isOpen={showRemoveConfirm}
        title={t.watchlist.batch.remove}
        message={interpolate(t.watchlist.batch.confirmRemove, { count: selectedCount })}
        variant="danger"
        isProcessing={isRemoving}
        onConfirm={handleRemoveConfirm}
        onCancel={closeRemoveConfirm}
      />
    </div>
  );
});
