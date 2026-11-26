/**
 * 送出中的狀態：execute 執行期間 isSubmitting 為 true。
 *
 * 成功、失敗都由呼叫端自己說明（寫入失敗用 describeWriteFailure，見 .claude/rules/frontend.md）：
 * 錯誤原樣丟回呼叫端，這裡不接住、不提示。每個操作失敗時要說什麼、哪些錯誤其實是使用者要的結果
 * （例如規則已經不在），只有呼叫端知道；在這裡接住的話只能給一句通用的話
 */

import { useState, useCallback } from "react";

export function useAsyncOperation() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const execute = useCallback(async <T>(operation: () => Promise<T>): Promise<T> => {
    setIsSubmitting(true);
    try {
      return await operation();
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, execute };
}
