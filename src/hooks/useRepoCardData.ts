/**
 * Repo 卡片資料取得（badges 與 signals），支援批次預載與個別取得。
 * 使用 React Query 管理快取與請求去重。
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ContextBadge, EarlySignal } from "../api/client";
import { getContextBadges, getRepoSignals } from "../api/client";
import { queryKeys } from "../lib/react-query";
import { nextRequestSeq } from "../utils/requestSeq";

interface UseRepoCardDataResult {
  badges: ContextBadge[];
  badgesLoading: boolean;
  /** 原始 signals 陣列，供需要直接存取的消費端使用（RepoCard 僅用 activeSignalCount）。 */
  signals: EarlySignal[];
  signalsLoading: boolean;
  activeSignalCount: number;
}

interface PreloadedData {
  badges?: ContextBadge[];
  signals?: EarlySignal[];
  /** 父層送出這一批的先後（nextRequestSeq）：卡片只採用比快取裡那份晚送出的 */
  requestSeq: number;
}

/** 卡片查詢裡存的資料：連同讀到它的那次請求是第幾個送出的，兩個來源才比得出先後。 */
interface Sequenced<T> {
  items: T;
  requestSeq: number;
}

function pickItems<T>(data: Sequenced<T>): T {
  return data.items;
}

/** 快取裡那份是同一次或比較晚送出的請求讀到的，就回傳它：先送出的晚回來不能蓋掉它。 */
function heldByLaterRequest<T>(
  client: QueryClient,
  key: QueryKey,
  requestSeq: number
): Sequenced<T> | undefined {
  const current = client.getQueryData<Sequenced<T>>(key);
  return current !== undefined && current.requestSeq >= requestSeq ? current : undefined;
}

/**
 * 單一 repo 卡片的 context badges 與 early signals。
 *
 * deferToBatch 由「擁有批次載入的父層」設為 true。設定後，卡片在批次負責
 * 期間不自行發請求——批次有 150ms debounce，個別請求會搶先跑掉，實測 200 個
 * repo 的 Grid 檢視因此發出 348 個請求（正確值是 8 個）。後端的批次端點對沒有
 * 資料的 repo 也會回空陣列，所以批次一到貨 preloaded 必為 defined，個別請求
 * 從來不是必要的；批次失敗時父層會把此旗標設回 false 當退路。
 *
 * 快取有兩個來源（父層的批次、卡片自己抓），兩邊都可能先送出的晚回來：含這張卡的那批還在途中、
 * 另一批失敗讓卡片改走自己抓；或卡片自己那次還在途中、批次已經恢復。所以父層換來的一批與卡片自己抓到的
 * 寫進快取前都比送出的先後，只留晚送出的那份。initialData 只在快取還沒有資料時才寫，不必比。
 */
export function useRepoCardData(
  repoId: number,
  preloaded?: PreloadedData,
  deferToBatch = false
): UseRepoCardDataResult {
  const queryClient = useQueryClient();
  const badgesKey = queryKeys.repoCard.badges(repoId);
  const signalsKey = queryKeys.repoCard.signals(repoId);

  // 若有預載資料，用 initialData 讓 React Query 立即顯示，但仍可被 refetch 覆蓋
  const badgesQuery = useQuery<Sequenced<ContextBadge[]>, Error, ContextBadge[]>({
    queryKey: badgesKey,
    queryFn: async () => {
      const requestSeq = nextRequestSeq();
      const response = await getContextBadges(repoId);
      return (
        heldByLaterRequest<ContextBadge[]>(queryClient, badgesKey, requestSeq) ?? {
          items: response.badges,
          requestSeq,
        }
      );
    },
    initialData: () =>
      preloaded?.badges === undefined
        ? undefined
        : { items: preloaded.badges, requestSeq: preloaded.requestSeq },
    select: pickItems,
    enabled: !deferToBatch && preloaded?.badges === undefined,
  });

  const signalsQuery = useQuery<Sequenced<EarlySignal[]>, Error, EarlySignal[]>({
    queryKey: signalsKey,
    queryFn: async () => {
      const requestSeq = nextRequestSeq();
      const response = await getRepoSignals(repoId);
      return (
        heldByLaterRequest<EarlySignal[]>(queryClient, signalsKey, requestSeq) ?? {
          items: response.signals,
          requestSeq,
        }
      );
    },
    initialData: () =>
      preloaded?.signals === undefined
        ? undefined
        : { items: preloaded.signals, requestSeq: preloaded.requestSeq },
    select: pickItems,
    enabled: !deferToBatch && preloaded?.signals === undefined,
  });

  // initialData 只在查詢還沒有資料時生效：父層之後換來的一批（追蹤清單重讀後重抓的、離開再回來時重抓的）
  // 要自己寫進去，否則卡片一直顯示第一次讀到的
  const preloadedBadges = preloaded?.badges;
  const preloadedSignals = preloaded?.signals;
  const preloadedSeq = preloaded?.requestSeq;
  useEffect(() => {
    if (preloadedBadges === undefined || preloadedSeq === undefined) return;
    const key = queryKeys.repoCard.badges(repoId);
    if (heldByLaterRequest(queryClient, key, preloadedSeq) !== undefined) return;
    queryClient.setQueryData<Sequenced<ContextBadge[]>>(key, {
      items: preloadedBadges,
      requestSeq: preloadedSeq,
    });
  }, [queryClient, repoId, preloadedBadges, preloadedSeq]);
  useEffect(() => {
    if (preloadedSignals === undefined || preloadedSeq === undefined) return;
    const key = queryKeys.repoCard.signals(repoId);
    if (heldByLaterRequest(queryClient, key, preloadedSeq) !== undefined) return;
    queryClient.setQueryData<Sequenced<EarlySignal[]>>(key, {
      items: preloadedSignals,
      requestSeq: preloadedSeq,
    });
  }, [queryClient, repoId, preloadedSignals, preloadedSeq]);

  const badges = badgesQuery.data ?? [];
  const signals = signalsQuery.data ?? [];

  // 計算未確認的活躍 signals 數量
  const activeSignalCount = signals.filter((s) => !s.acknowledged).length;

  return {
    badges,
    badgesLoading: preloaded?.badges !== undefined ? false : badgesQuery.isLoading,
    signals,
    signalsLoading: preloaded?.signals !== undefined ? false : signalsQuery.isLoading,
    activeSignalCount,
  };
}
