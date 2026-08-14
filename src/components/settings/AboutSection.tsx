/**
 * 關於 StarScope 區塊。
 * 顯示版本號、GitHub 連結與授權資訊。
 */

import type { MouseEvent, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { safeOpenUrl } from "../../utils/url";

// 版本唯一來源是 package.json：1.0.0 發版時四個版本來源都升了、唯獨這裡的
// 硬編碼被漏掉（顯示 0.4.3）。改為匯入後，這類漂移由構造保證不可能發生。
import { version as APP_VERSION } from "../../../package.json";
const GITHUB_URL = "https://github.com/Neal75418/StarScope";
const LICENSE_URL = "https://opensource.org/licenses/MIT";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    void safeOpenUrl(href);
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
