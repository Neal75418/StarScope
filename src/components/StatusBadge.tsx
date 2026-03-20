/**
 * 共用狀態徽章元件（載入中、錯誤、空白）。
 */

interface StatusBadgeProps {
  variant: "loading" | "error" | "empty";
  classPrefix: string;
  error?: string;
  fetching?: boolean;
  onClick?: () => void;
  emptyTooltip?: string;
}

export function StatusBadge({
  variant,
  classPrefix,
  error,
  fetching,
  onClick,
  emptyTooltip,
}: StatusBadgeProps) {
  if (variant === "loading") {
    return <span className={`${classPrefix} ${classPrefix}-loading`}>...</span>;
  }

  if (variant === "error") {
    return (
      <span className={`${classPrefix} ${classPrefix}-error`} title={error}>
        !
      </span>
    );
  }

  // variant === "empty"
  return (
    <button
      className={`${classPrefix} ${classPrefix}-empty`}
      onClick={onClick}
      disabled={fetching}
      title={emptyTooltip}
    >
      {fetching ? "..." : "?"}
    </button>
  );
}
