/**
 * 趨勢箭頭元件，顯示方向指示。
 */

interface TrendArrowProps {
  trend: number | null; // -1, 0, 1
  size?: "sm" | "md" | "lg";
}

export function TrendArrow({ trend, size = "md" }: TrendArrowProps) {
  const sizeClass = `trend-arrow-${size}`;

  if (trend === null) {
    return (
      <span className={`${sizeClass} trend-arrow-neutral`} aria-hidden="true">
        —
      </span>
    );
  }

  if (trend > 0) {
    return (
      <span className={`${sizeClass} trend-arrow-up`} aria-hidden="true">
        ↑
      </span>
    );
  }

  if (trend < 0) {
    return (
      <span className={`${sizeClass} trend-arrow-down`} aria-hidden="true">
        ↓
      </span>
    );
  }

  return (
    <span className={`${sizeClass} trend-arrow-neutral`} aria-hidden="true">
      →
    </span>
  );
}
