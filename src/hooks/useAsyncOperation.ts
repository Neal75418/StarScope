/**
 * 通用非同步操作封裝，含 loading 與 toast 通知。
 */

import { useState, useCallback } from "react";
import { useI18n } from "../i18n";
import { getErrorMessage } from "../utils/error";

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export function useAsyncOperation(toast: Toast) {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const execute = useCallback(
    async <T>(operation: () => Promise<T>, successMessage?: string): Promise<boolean> => {
      setIsSubmitting(true);
      try {
        await operation();
        if (successMessage) {
          toast.success(successMessage);
        }
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t.common.error));
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [toast, t]
  );

  return { isSubmitting, execute };
}
