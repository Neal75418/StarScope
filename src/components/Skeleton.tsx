/**
 * 骨架屏元件，載入中的佔位顯示。
 */

import type { CSSProperties } from "react";
import "./Skeleton.css";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular" | "rounded";
  width?: string | number;
  height?: string | number;
  animation?: "pulse" | "wave" | "none";
  style?: CSSProperties;
}

export function Skeleton({
  className = "",
  variant = "text",
  width,
  height,
  animation = "pulse",
  style,
}: SkeletonProps) {
  const styles: CSSProperties = {
    width,
    height,
    ...style,
  };

  return (
    <span
      aria-hidden="true"
      className={`skeleton skeleton-${variant} skeleton-${animation} ${className}`}
      style={styles}
    />
  );
}
