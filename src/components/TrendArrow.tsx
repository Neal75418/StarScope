/**
 * Trend arrow component showing direction indicator.
 */

interface TrendArrowProps {
  trend: number | null; // -1, 0, 1
  size?: "sm" | "md" | "lg";
}

export function TrendArrow({ trend, size = "md" }: TrendArrowProps) {
  const sizeClasses = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
  };

  if (trend === null) {
    return <span className={`${sizeClasses[size]} text-gray-400`}>—</span>;
  }

  if (trend > 0) {
    return <span className={`${sizeClasses[size]} text-green-500`}>↑</span>;
  }

  if (trend < 0) {
    return <span className={`${sizeClasses[size]} text-red-500`}>↓</span>;
  }

  return <span className={`${sizeClasses[size]} text-gray-400`}>→</span>;
}
