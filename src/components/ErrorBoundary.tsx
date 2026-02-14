/**
 * Error Boundary 元件，捕捉子元件的 JavaScript 錯誤並顯示 fallback UI。
 */

import { Component, ErrorInfo, ReactNode } from "react";
import { I18nContext, TranslationKeys, getInitialLanguage } from "../i18n";
import { logger } from "../utils/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// 錯誤 UI 獨立為元件以存取 context
function ErrorFallbackUI({
  error,
  onRetry,
  t,
}: {
  error: Error | null;
  onRetry: () => void;
  t: TranslationKeys;
}) {
  return (
    <div className="error-boundary">
      <div className="error-boundary-content">
        <h2>{t.errorBoundary.title}</h2>
        <p className="error-message">{error?.message || t.errorBoundary.message}</p>
        <div className="error-boundary-actions">
          <button onClick={onRetry} className="btn btn-primary">
            {t.errorBoundary.tryAgain}
          </button>
          <button onClick={() => window.location.reload()} className="btn">
            {t.errorBoundary.reloadApp}
          </button>
        </div>
        {import.meta.env.DEV && error && (
          <details className="error-details">
            <summary>{t.errorBoundary.errorDetails}</summary>
            <pre>{error.stack}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 開發模式下記錄錯誤
    logger.error("[ErrorBoundary] 捕捉到錯誤:", error);
    logger.error("[ErrorBoundary] 元件堆疊:", errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <I18nContext.Consumer>
          {(context) => {
            if (!context) {
              // context 不可用時的 fallback（正常使用不會發生）
              const fallbacks = {
                en: {
                  title: "Something went wrong",
                  message: "An unexpected error occurred",
                  tryAgain: "Try Again",
                  reloadApp: "Reload App",
                },
                zh: {
                  title: "發生錯誤",
                  message: "發生了非預期的錯誤",
                  tryAgain: "重試",
                  reloadApp: "重新載入應用",
                },
              };
              const fb = getInitialLanguage().startsWith("zh") ? fallbacks.zh : fallbacks.en;
              return (
                <div className="error-boundary">
                  <div className="error-boundary-content">
                    <h2>{fb.title}</h2>
                    <p className="error-message">{this.state.error?.message || fb.message}</p>
                    <div className="error-boundary-actions">
                      <button onClick={this.handleRetry} className="btn btn-primary">
                        {fb.tryAgain}
                      </button>
                      <button onClick={() => window.location.reload()} className="btn">
                        {fb.reloadApp}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <ErrorFallbackUI error={this.state.error} onRetry={this.handleRetry} t={context.t} />
            );
          }}
        </I18nContext.Consumer>
      );
    }

    return this.props.children;
  }
}
