/**
 * 「自上次以來」摘要：整個 app session 抓一次，顯示後推進游標，重整只附加。
 *
 * 這個 hook 掛在 Dashboard 上，面板真的顯示時（canMarkSeen）才送 seen。啟動頁的預抓
 * （useStartupPage）只讀同一個 query key，不送 seen。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDigest, getSyncStatus, markDigestSeen } from "../api/client";
import type { DigestResponse } from "../api/client";
import { queryKeys } from "../lib/react-query";
import { mergeDigest } from "../utils/digest";
import { logger } from "../utils/logger";

// 模組常數：每次 render 新建的陣列放進 useCallback 依賴會讓 appendNew 每次都換一個
const DIGEST_KEY = queryKeys.digest.session();
const SYNC_STATUS_KEY = queryKeys.repos.syncStatus();

// 送過 seen 的那幾批（以快取裡的物件為 key）。放模組層級才撐得過 Dashboard 重新掛載：
// 換頁回來時快取給的是同一個物件，若再送一次，會把刪除後被壓低的游標抬回去
const sentBatches = new WeakSet<DigestResponse>();

interface UseDigestOptions {
  /** diagnostics 的 fetch_in_progress；由 true 轉 false＝抓取完成，附加新項目 */
  isFetchInProgress: boolean;
  /**
   * 面板真的在畫面上。Dashboard 的載入骨架、錯誤畫面、引導卡都不渲染面板，
   * 但 hook 必須無條件呼叫——這時送 seen 等於把使用者沒看到的東西標成看過
   */
  canMarkSeen: boolean;
}

export function useDigest({ isFetchInProgress, canMarkSeen }: UseDigestOptions) {
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

  // 面板顯示中、而且這一批還沒送過才送；appendNew／重試會產生新的物件，那時再送
  useEffect(() => {
    if (!query.data || !canMarkSeen || sentBatches.has(query.data)) return;
    sentBatches.add(query.data);
    markDigestSeen(query.data.cursor).catch((err: unknown) => {
      // 送不出去只代表下次會再看到同一批，不影響這次的畫面
      logger.warn("[Digest] 推進游標失敗:", err);
    });
  }, [query.data, canMarkSeen]);

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

  // HN 與新版本由另外的排程寫、不持有抓取的鎖：抓取結束那一刻它們還沒寫進去，上面的轉換接不到。
  // 讀背景偵測（useBackgroundStarSync）輪詢的同一份同步狀態（停用的觀察者，不另外發請求），
  // 情境訊號的寫入時間變了就附加；第一次讀到的值只當基準
  const contextWrittenAt = useQuery({
    queryKey: SYNC_STATUS_KEY,
    queryFn: ({ signal }) => getSyncStatus(signal),
    enabled: false,
    select: (status) => status.last_context_signal_at,
  }).data;
  const seenContextRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (contextWrittenAt === undefined) return;
    const seen = seenContextRef.current;
    seenContextRef.current = contextWrittenAt;
    if (seen !== undefined && seen !== contextWrittenAt && query.data) void appendNew();
  }, [contextWrittenAt, appendNew, query.data]);

  return {
    digest: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: () => void query.refetch(),
    appendNew,
    appendFailed,
  };
}
