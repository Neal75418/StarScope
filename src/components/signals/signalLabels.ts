/**
 * Shared signal labels and constants.
 */

import { EarlySignalType, EarlySignalSeverity } from "../../api/client";
import { useI18n } from "../../i18n";

export const SIGNAL_TYPE_ICONS: Record<EarlySignalType, string> = {
  rising_star: "⭐",
  sudden_spike: "📈",
  breakout: "🚀",
  viral_hn: "🔥",
  release_surge: "📦",
};

export const SEVERITY_COLORS: Record<EarlySignalSeverity, string> = {
  low: "var(--gray-400)",
  medium: "var(--warning-color)",
  high: "var(--danger-color)",
};

export function useSignalLabels() {
  const { t } = useI18n();

  const signalTypeLabels: Record<EarlySignalType, string> = {
    rising_star: t.signals.types.rising_star,
    sudden_spike: t.signals.types.sudden_spike,
    breakout: t.signals.types.breakout,
    viral_hn: t.signals.types.viral_hn,
    release_surge: t.signals.types.release_surge,
  };

  const severityLabels: Record<EarlySignalSeverity, string> = {
    low: t.signals.severity.low,
    medium: t.signals.severity.medium,
    high: t.signals.severity.high,
  };

  return { signalTypeLabels, severityLabels, t };
}
