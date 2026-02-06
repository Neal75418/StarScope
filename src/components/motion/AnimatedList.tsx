/**
 * 動畫列表元件，支援子項目交錯進場效果。
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface AnimatedListProps {
  children: ReactNode[];
  className?: string;
  staggerDelay?: number;
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: {
    opacity: 0,
    y: 12,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: "easeOut" as const,
    },
  },
};

export function AnimatedList({ children, className, staggerDelay = 0.05 }: AnimatedListProps) {
  const variants = {
    ...containerVariants,
    visible: {
      transition: {
        staggerChildren: staggerDelay,
      },
    },
  };

  return (
    <motion.div initial="hidden" animate="visible" variants={variants} className={className}>
      {children}
    </motion.div>
  );
}

interface AnimatedListItemProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedListItem({ children, className }: AnimatedListItemProps) {
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  );
}
