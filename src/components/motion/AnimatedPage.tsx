/**
 * 頁面切換動畫元件（純 CSS 實作）。
 */

import type { ReactNode } from "react";

interface AnimatedPageProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedPage({ children, className }: AnimatedPageProps) {
  return <div className={`animated-page ${className ?? ""}`}>{children}</div>;
}
