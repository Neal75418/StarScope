/**
 * Export data section component.
 */

import {
  getExportWatchlistUrl,
  getExportSignalsUrl,
  getExportFullReportUrl,
  getDigestUrl,
} from "../../api/client";
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
            <a href={getExportWatchlistUrl("json")} className="btn btn-sm" download>
              {t.settings.export.json}
            </a>
            <a href={getExportWatchlistUrl("csv")} className="btn btn-sm" download>
              {t.settings.export.csv}
            </a>
          </div>
        </div>

        <div className="export-card">
          <h3>{t.settings.export.cards.signals.title}</h3>
          <p>{t.settings.export.cards.signals.desc}</p>
          <div className="export-actions">
            <a href={getExportSignalsUrl("json")} className="btn btn-sm" download>
              {t.settings.export.json}
            </a>
            <a href={getExportSignalsUrl("csv")} className="btn btn-sm" download>
              {t.settings.export.csv}
            </a>
          </div>
        </div>

        <div className="export-card">
          <h3>{t.settings.export.cards.fullReport.title}</h3>
          <p>{t.settings.export.cards.fullReport.desc}</p>
          <div className="export-actions">
            <a href={getExportFullReportUrl()} className="btn btn-sm btn-primary" download>
              {t.settings.export.cards.fullReport.download}
            </a>
          </div>
        </div>

        <div className="export-card">
          <h3>{t.settings.export.cards.weeklyDigest.title}</h3>
          <p>{t.settings.export.cards.weeklyDigest.desc}</p>
          <div className="export-actions">
            <a href={getDigestUrl("weekly", "html")} className="btn btn-sm" target="_blank">
              {t.settings.export.html}
            </a>
            <a href={getDigestUrl("weekly", "md")} className="btn btn-sm" download>
              {t.settings.export.markdown}
            </a>
            <a href={getDigestUrl("weekly", "json")} className="btn btn-sm" download>
              {t.settings.export.json}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
