/**
 * 共用的「加入追蹤清單」邏輯。
 * 管理 addingRepoIds + locallyAdded 狀態，供 Discovery 和 Trends 頁面使用。
 */

import { useState, useCallback } from "react";
import { addRepo } from "../api/client";

interface AddToWatchlistOptions {
  onSuccess?: (fullName: string) => void;
  onError?: (fullName: string, err: unknown) => void;
}

interface UseAddToWatchlistReturn {
  addingRepoIds: Set<number>;
  locallyAdded: Set<string>;
  handleAdd: (input: {
    id: number;
    owner: string;
    name: string;
    full_name: string;
  }) => Promise<void>;
}

export function useAddToWatchlist(options: AddToWatchlistOptions = {}): UseAddToWatchlistReturn {
  const [addingRepoIds, setAddingRepoIds] = useState<Set<number>>(new Set());
  const [locallyAdded, setLocallyAdded] = useState<Set<string>>(new Set());

  const handleAdd = useCallback(
    async (input: { id: number; owner: string; name: string; full_name: string }) => {
      setAddingRepoIds((prev) => new Set(prev).add(input.id));
      try {
        await addRepo({ owner: input.owner, name: input.name });
        setLocallyAdded((prev) => new Set(prev).add(input.full_name.toLowerCase()));
        options.onSuccess?.(input.full_name);
      } catch (err) {
        options.onError?.(input.full_name, err);
      } finally {
        setAddingRepoIds((prev) => {
          const next = new Set(prev);
          next.delete(input.id);
          return next;
        });
      }
    },
    [options]
  );

  return { addingRepoIds, locallyAdded, handleAdd };
}
