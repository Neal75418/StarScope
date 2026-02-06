/**
 * 骨架屏元件，載入中的佔位顯示。
 */

import React from "react";
import "./Skeleton.css";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular" | "rounded";
  width?: string | number;
  height?: string | number;
  animation?: "pulse" | "wave" | "none";
  style?: React.CSSProperties;
}

export function Skeleton({
  className = "",
  variant = "text",
  width,
  height,
  animation = "pulse",
  style,
}: SkeletonProps) {
  const styles: React.CSSProperties = {
    width,
    height,
    ...style,
  };

  return (
    <span
      className={`skeleton skeleton-${variant} skeleton-${animation} ${className}`}
      style={styles}
    />
  );
}
