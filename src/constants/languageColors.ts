/**
 * GitHub 語言顏色 — 唯一事實來源。
 * LanguagesBadge 需要 bg + text，LanguagesPanel 僅需 bg。
 */

export const LANGUAGE_COLORS: Record<string, { bg: string; text: string }> = {
  TypeScript: { bg: "#3178c6", text: "#ffffff" },
  JavaScript: { bg: "#f1e05a", text: "#000000" },
  Python: { bg: "#3572A5", text: "#ffffff" },
  Rust: { bg: "#dea584", text: "#000000" },
  Go: { bg: "#00ADD8", text: "#ffffff" },
  Java: { bg: "#b07219", text: "#ffffff" },
  "C++": { bg: "#f34b7d", text: "#ffffff" },
  C: { bg: "#555555", text: "#ffffff" },
  "C#": { bg: "#178600", text: "#ffffff" },
  Ruby: { bg: "#701516", text: "#ffffff" },
  PHP: { bg: "#4F5D95", text: "#ffffff" },
  Swift: { bg: "#F05138", text: "#ffffff" },
  Kotlin: { bg: "#A97BFF", text: "#ffffff" },
  Shell: { bg: "#89e051", text: "#000000" },
  HTML: { bg: "#e34c26", text: "#ffffff" },
  CSS: { bg: "#563d7c", text: "#ffffff" },
  SCSS: { bg: "#c6538c", text: "#ffffff" },
  Vue: { bg: "#41b883", text: "#ffffff" },
  Dart: { bg: "#00B4AB", text: "#ffffff" },
  Scala: { bg: "#c22d40", text: "#ffffff" },
  Elixir: { bg: "#6e4a7e", text: "#ffffff" },
  Haskell: { bg: "#5e5086", text: "#ffffff" },
  Lua: { bg: "#000080", text: "#ffffff" },
  R: { bg: "#198CE7", text: "#ffffff" },
  Julia: { bg: "#a270ba", text: "#ffffff" },
  Zig: { bg: "#ec915c", text: "#000000" },
  Perl: { bg: "#0298c3", text: "#ffffff" },
  "Objective-C": { bg: "#438eff", text: "#ffffff" },
  Clojure: { bg: "#db5855", text: "#ffffff" },
  Dockerfile: { bg: "#384d54", text: "#ffffff" },
  Makefile: { bg: "#427819", text: "#ffffff" },
  Jupyter: { bg: "#DA5B0B", text: "#ffffff" },
};

const DEFAULT_COLORS = { bg: "#6b7280", text: "#f3f4f6" };

export function getLanguageColors(language: string): { bg: string; text: string } {
  return LANGUAGE_COLORS[language] || DEFAULT_COLORS;
}

export function getLanguageColor(language: string): string {
  return (LANGUAGE_COLORS[language] || DEFAULT_COLORS).bg;
}
