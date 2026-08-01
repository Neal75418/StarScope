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
  updateInterest,
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
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: InterestCreate }) => updateInterest(id, input),
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
    create: (input: InterestCreate) => createMutation.mutate(input),
    update: (id: number, input: InterestCreate) => updateMutation.mutate({ id, input }),
    remove: (id: number) => removeMutation.mutate(id),
    addExclude: (term: string) => addExcludeMutation.mutate(term),
    removeExclude: (id: number) => removeExcludeMutation.mutate(id),
  };
}
