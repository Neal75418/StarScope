/**
 * 資料匯出區塊元件，匯出 watchlist 為 JSON 或 CSV。
 */

import { getExportWatchlistJsonUrl, getExportWatchlistCsvUrl } from "../../api/client";
import { useI18n } from "../../i18n";

export function ExportSection() {
  const { t } = useI18n();

  return (
    <section className="settings-section" data-testid="export-section">
      <h2>{t.settings.export.title}</h2>
      <p className="settings-description">{t.settings.export.subtitle}</p>

      <div className="export-grid">
        <div className="export-card">
          <h3>{t.settings.export.cards.watchlist.title}</h3>
          <p>{t.settings.export.cards.watchlist.desc}</p>
          <div className="export-actions">
            <a href={getExportWatchlistJsonUrl()} className="btn btn-sm btn-primary" download>
              {t.settings.export.json}
            </a>
            <a href={getExportWatchlistCsvUrl()} className="btn btn-sm btn-outline" download>
              {t.settings.export.csv}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
