/**
 * 淡入動畫元件。
 */

import { motion } from "framer-motion";
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration, ease: "easeOut" }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
