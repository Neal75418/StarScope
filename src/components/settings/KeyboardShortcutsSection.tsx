/**
 * 鍵盤快捷鍵速查表。
 * 靜態元件，列出各頁面的所有快捷鍵。
 */

import { memo } from "react";
import { useI18n } from "../../i18n";

interface ShortcutEntry {
  keys: string[];
  action: string;
}

interface ShortcutGroup {
  category: string;
  entries: ShortcutEntry[];
}

function Key({ k }: { k: string }) {
  return <kbd className="shortcut-key">{k}</kbd>;
}

function ShortcutRow({ entry }: { entry: ShortcutEntry }) {
  return (
    <tr className="shortcut-row">
      <td className="shortcut-keys-cell">
        {entry.keys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="shortcut-separator">+</span>}
            <Key k={k} />
          </span>
        ))}
      </td>
      <td className="shortcut-action-cell">{entry.action}</td>
    </tr>
  );
}

export const KeyboardShortcutsSection = memo(function KeyboardShortcutsSection() {
  const { t } = useI18n();

  const groups: ShortcutGroup[] = [
    {
      category: t.settings.keyboardShortcuts.global,
      entries: [
        { keys: ["1"], action: t.nav.dashboard },
        { keys: ["2"], action: t.nav.discovery },
        { keys: ["3"], action: t.nav.watchlist },
        { keys: ["4"], action: t.nav.trends },
        { keys: ["5"], action: t.nav.compare },
        { keys: ["6"], action: t.nav.settings },
      ],
    },
    {
      category: t.settings.keyboardShortcuts.watchlist,
      entries: [
        { keys: ["N"], action: t.watchlist.addRepo },
        { keys: ["/"], action: t.watchlist.searchPlaceholder },
        { keys: ["R"], action: t.watchlist.refreshAll },
      ],
    },
    {
      category: t.settings.keyboardShortcuts.discovery,
      entries: [
        { keys: ["/"], action: t.discovery.searchPlaceholder },
        { keys: ["Esc"], action: t.common.close },
      ],
    },
    {
      category: t.settings.keyboardShortcuts.compare,
      entries: [{ keys: ["Esc"], action: t.common.cancel }],
    },
  ];

  return (
    <section className="settings-section" data-testid="keyboard-shortcuts-section">
      <h2>{t.settings.keyboardShortcuts.title}</h2>
      <p className="settings-description">{t.settings.keyboardShortcuts.description}</p>

      <div className="shortcut-groups">
        {groups.map((group) => (
          <div key={group.category} className="shortcut-group">
            <div className="shortcut-group-title">{group.category}</div>
            <table className="shortcut-table">
              <thead>
                <tr>
                  <th>{t.settings.keyboardShortcuts.shortcut}</th>
                  <th>{t.settings.keyboardShortcuts.action}</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry, i) => (
                  <ShortcutRow key={i} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
});
