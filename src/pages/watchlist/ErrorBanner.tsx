/**
 * 錯誤橫幅元件
 */

interface ErrorBannerProps {
  error: string;
  onClear: () => void;
}

export function ErrorBanner({ error, onClear }: ErrorBannerProps) {
  return (
    <div className="error-banner">
      {error}
      <button onClick={onClear}>x</button>
    </div>
  );
}
