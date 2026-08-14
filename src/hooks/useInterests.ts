/**
 * 興趣清單與黑名單管理 Hook。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addExclusion,
  createInterest,
  deleteInterest,
  getExclusions,
  getInterests,
  removeExclusion,
} from "../api/client";
import type { InterestCreate } from "../api/types";
import { queryKeys } from "../lib/react-query";

export function useInterests() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.interests.all });
  };

  const interestsQuery = useQuery({
    queryKey: queryKeys.interests.list(),
    queryFn: ({ signal }) => getInterests(signal),
  });

  const exclusionsQuery = useQuery({
    queryKey: queryKeys.interests.exclusions(),
    queryFn: ({ signal }) => getExclusions(signal),
  });

  const createMutation = useMutation({
    mutationFn: (input: InterestCreate) => createInterest(input),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (id: number) => deleteInterest(id),
    onSuccess: invalidate,
  });
  const addExcludeMutation = useMutation({
    mutationFn: (term: string) => addExclusion(term),
    onSuccess: invalidate,
  });
  const removeExcludeMutation = useMutation({
    mutationFn: (id: number) => removeExclusion(id),
    onSuccess: invalidate,
  });

  return {
    interests: interestsQuery.data?.interests ?? [],
    exclusions: exclusionsQuery.data?.exclusions ?? [],
    isLoading: interestsQuery.isLoading || exclusionsQuery.isLoading,
    // create/remove 回傳 Promise（mutateAsync）：呼叫端可用 try/catch 依實際結果決定 toast，
    // 避免 fire-and-forget 導致失敗時仍顯示成功訊息。
    create: (input: InterestCreate) => createMutation.mutateAsync(input),
    remove: (id: number) => removeMutation.mutateAsync(id),
    addExclude: (term: string) => addExcludeMutation.mutateAsync(term),
    removeExclude: (id: number) => removeExcludeMutation.mutateAsync(id),
  };
}
