/**
 * 個人化推薦 hook，封裝 React Query 邏輯。
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../lib/react-query";
import { getPersonalizedRecommendations } from "../api/client";
import type { PersonalizedResponse } from "../api/types";

export function usePersonalizedRecs(limit: number = 10) {
  return useQuery<PersonalizedResponse>({
    queryKey: queryKeys.recommendations.personalized(limit),
    queryFn: ({ signal }) => getPersonalizedRecommendations(limit, signal),
  });
}
