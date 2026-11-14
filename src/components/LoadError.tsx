/**
 * 讀不到資料時的一行說明與重試鈕。
 */

import { useI18n } from "../i18n";

interface LoadErrorProps {
  message: string;
  onRetry: () => void;
  /** 重試（或輪詢）進行中：按鈕改顯示「重試中」，在有結果之前不再接受點擊 */
  isRetrying: boolean;
  /** 版面由用它的地方決定（設定頁的一行字、通知下拉裡的一列） */
  className: string;
  testId?: string;
}

export function LoadError({ message, onRetry, isRetrying, className, testId }: LoadErrorProps) {
  const { t } = useI18n();

  return (
    <div className={className} data-testid={testId}>
      <span role="alert">{message}</span>{" "}
      {/* aria-disabled 而不是 disabled，也不把按鈕拿掉：鍵盤按下重試後焦點要留在這顆按鈕上，
          離開它（掉到 body）的話，鍵盤與螢幕閱讀器的使用者就失去位置 */}
      <button
        type="button"
        className="btn btn-sm"
        aria-disabled={isRetrying}
        onClick={isRetrying ? undefined : onRetry}
      >
        {isRetrying ? t.common.retrying : t.common.retry}
      </button>
    </div>
  );
}
