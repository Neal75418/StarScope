/**
 * 快速匯出下拉選單：JSON / CSV。
 *
 * 不用 `<a href download>`：頁面導覽不帶 X-Session-Secret，正式版的 sidecar 會回 403；
 * 而且 Tauri 的 WebView 根本不處理網頁式下載。存檔流程在 utils/saveFile。
 */

import { getExportWatchlistJsonUrl, getExportWatchlistCsvUrl } from "../../api/client";
import { useI18n } from "../../i18n";
import { DropdownMenu } from "../../components/DropdownMenu";
import { saveExport } from "../../utils/saveFile";
import { getErrorMessage } from "../../utils/error";

interface ExportDropdownProps {
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}

export function ExportDropdown({ onSaved, onFailed }: ExportDropdownProps) {
  const { t } = useI18n();
  const copy = t.watchlist.export;

  const run = async (url: string, fallbackName: string) => {
    try {
      if ((await saveExport(url, fallbackName)) === "saved") onSaved(copy.saved);
    } catch (err) {
      onFailed(copy.failed.replace("{error}", getErrorMessage(err, t.common.error)));
    }
  };

  return (
    <DropdownMenu label={copy.button} buttonTestId="export-btn" menuTestId="export-menu">
      {(close) => (
        <>
          <button
            type="button"
            className="export-dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              void run(getExportWatchlistJsonUrl(), "starscope_watchlist.json");
            }}
          >
            {copy.json}
          </button>
          <button
            type="button"
            className="export-dropdown-item"
            role="menuitem"
            onClick={() => {
              close();
              void run(getExportWatchlistCsvUrl(), "starscope_watchlist.csv");
            }}
          >
            {copy.csv}
          </button>
        </>
      )}
    </DropdownMenu>
  );
}
