/**
 * Quick Pick Chips：提供常用的語言和主題捷徑，讓使用者一鍵觸發篩選。
 */

import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

const QUICK_LANGUAGES = ["TypeScript", "Python", "Rust", "Go"] as const;
const QUICK_TOPICS = ["machine-learning", "web", "cli", "devops"] as const;

interface QuickPicksProps {
  onSelectLanguage: (lang: string) => void;
  onSelectTopic: (topic: string) => void;
}

export function QuickPicks({ onSelectLanguage, onSelectTopic }: QuickPicksProps) {
  const { t } = useI18n();

  return (
    <div className={styles.quickPicks}>
      <span className={styles.quickPicksLabel}>{t.discovery.quickPicks.languages}</span>
      {QUICK_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className={styles.quickPickChip}
          onClick={() => onSelectLanguage(lang)}
        >
          {lang}
        </button>
      ))}
      <span className={styles.quickPicksDivider} />
      <span className={styles.quickPicksLabel}>{t.discovery.quickPicks.topics}</span>
      {QUICK_TOPICS.map((topic) => (
        <button
          key={topic}
          type="button"
          className={styles.quickPickChip}
          onClick={() => onSelectTopic(topic)}
        >
          {topic}
        </button>
      ))}
    </div>
  );
}
