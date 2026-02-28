/**
 * 載入中狀態元件
 */

import { useI18n } from "../../i18n";

export function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="loading">{t.common.loading}</div>
    </div>
  );
}
