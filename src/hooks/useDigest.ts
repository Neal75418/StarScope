/**
 * 「自上次以來」摘要：整個 app session 抓一次，顯示後推進游標，重整只附加。
 *
 * 這個 hook 掛在 Dashboard 上——掛上＝使用者看得到，才送 seen。啟動頁的預抓
 * （useStartupPage）只讀同一個 query key，不送 seen。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDigest, markDigestSeen } from "../api/client";
import type { DigestResponse } from "../api/client";
import { queryKeys } from "../lib/react-query";
import { mergeDigest } from "../utils/digest";
import { logger } from "../utils/logger";

// 模組常數：每次 render 新建的陣列放進 useCallback 依賴會讓 appendNew 每次都換一個
const DIGEST_KEY = queryKeys.digest.session();

interface UseDigestOptions {
  /** diagnostics 的 fetch_in_progress；由 true 轉 false＝抓取完成，附加新項目 */
  isFetchInProgress: boolean;
}

export function useDigest({ isFetchInProgress }: UseDigestOptions) {
  const qc = useQueryClient();
  const [appendFailed, setAppendFailed] = useState(false);

  const query = useQuery<DigestResponse>({
    queryKey: DIGEST_KEY,
    queryFn: ({ signal }) => getDigest(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  // 資料（cursor）一變就送。重送是冪等的（後端逐欄取 max），只會把 seen_at 更新成
  // 最近一次看到 Dashboard 的時間——換頁回來重新掛載時會再送一次，那正是「看過」
  useEffect(() => {
    if (!query.data) return;
    markDigestSeen(query.data.cursor).catch((err: unknown) => {
      // 送不出去只代表下次會再看到同一批，不影響這次的畫面
      logger.warn("[Digest] 推進游標失敗:", err);
    });
  }, [query.data]);

  const appendNew = useCallback(async () => {
    try {
      const next = await getDigest();
      qc.setQueryData<DigestResponse>(DIGEST_KEY, (prev) =>
        prev ? mergeDigest(prev, next) : next
      );
      setAppendFailed(false);
    } catch (err) {
      logger.warn("[Digest] 附加新項目失敗:", err);
      setAppendFailed(true);
    }
  }, [qc]);

  const wasFetchingRef = useRef(isFetchInProgress);
  useEffect(() => {
    const was = wasFetchingRef.current;
    wasFetchingRef.current = isFetchInProgress;
    if (was && !isFetchInProgress && query.data) void appendNew();
  }, [isFetchInProgress, appendNew, query.data]);

  return {
    digest: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: () => void query.refetch(),
    appendNew,
    appendFailed,
  };
}
