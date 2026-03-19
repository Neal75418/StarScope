/**
 * 關於 StarScope 區塊。
 * 顯示版本號、GitHub 連結與授權資訊。
 */

import { useI18n } from "../../i18n";
import { openUrl } from "@tauri-apps/plugin-opener";

const APP_VERSION = "0.4.0";
const GITHUB_URL = "https://github.com/Neal75418/StarScope";
const LICENSE_URL = "https://opensource.org/licenses/MIT";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    void openUrl(href);
  };
  return (
    <a href={href} onClick={handleClick} className="about-link">
      {children}
    </a>
  );
}

export function AboutSection() {
  const { t } = useI18n();

  return (
    <section className="settings-section about-section" data-testid="about-section">
      <h2>{t.settings.about.title}</h2>
      <div className="about-body">
        <div className="about-logo-wrap">
          <span className="about-logo">★</span>
          <span className="about-app-name">StarScope</span>
        </div>
        <div className="about-meta">
          <div className="about-row">
            <span className="about-label">{t.settings.about.version}</span>
            <span className="about-value">{APP_VERSION}</span>
          </div>
          <div className="about-row">
            <span className="about-label">{t.settings.about.license}</span>
            <ExternalLink href={LICENSE_URL}>{t.settings.about.mit}</ExternalLink>
          </div>
        </div>
        <div className="about-links">
          <ExternalLink href={GITHUB_URL}>{t.settings.about.github}</ExternalLink>
        </div>
      </div>
    </section>
  );
}
