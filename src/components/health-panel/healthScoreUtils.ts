/**
 * Utility functions for health score display.
 */

import { interpolate } from "../../i18n";

export function getScoreColor(score: number | null): string {
  if (score === null) return "var(--gray-400)";
  if (score >= 80) return "var(--success-color)";
  if (score >= 60) return "var(--warning-color)";
  return "var(--danger-color)";
}

export interface TimeTranslations {
  na: string;
  hours: string;
  days: string;
  weeks: string;
}

export function formatResponseTime(hours: number | null, timeT: TimeTranslations): string {
  if (hours === null) return timeT.na;
  if (hours < 24) return interpolate(timeT.hours, { value: hours.toFixed(1) });
  const days = hours / 24;
  if (days < 7) return interpolate(timeT.days, { value: days.toFixed(1) });
  const weeks = days / 7;
  return interpolate(timeT.weeks, { value: weeks.toFixed(1) });
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
