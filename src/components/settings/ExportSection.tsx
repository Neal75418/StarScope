/**
 * Export data section component.
 * Simplified to only export watchlist as JSON.
 */

import { getExportWatchlistJsonUrl } from "../../api/client";
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
          </div>
        </div>
      </div>
    </section>
  );
}
