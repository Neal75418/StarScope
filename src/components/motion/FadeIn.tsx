/**
 * 淡入動畫元件（純 CSS 實作，取代 framer-motion）。
 */

import type { ReactNode, CSSProperties } from "react";

interface FadeInProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  delay?: number;
  duration?: number;
}

export function FadeIn({ children, className, style, delay = 0, duration = 0.2 }: FadeInProps) {
  return (
    <div
      className={`fade-in ${className ?? ""}`}
      style={{
        ...style,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
      }}
    >
      {children}
    </div>
  );
}
