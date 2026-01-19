/**
 * Error Boundary component - catches JavaScript errors in child components.
 * Displays a fallback UI instead of crashing the entire application.
 */

import { Component, ErrorInfo, ReactNode } from "react";
import { I18nContext, TranslationKeys } from "../i18n";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Separate component for error UI to use context
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
    // Log error to console in development
    console.error("Error caught by ErrorBoundary:", error);
    console.error("Component stack:", errorInfo.componentStack);
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
              // Fallback if context is not available (shouldn't happen in normal usage)
              return (
                <div className="error-boundary">
                  <div className="error-boundary-content">
                    <h2>Something went wrong</h2>
                    <p className="error-message">
                      {this.state.error?.message || "An unexpected error occurred"}
                    </p>
                    <div className="error-boundary-actions">
                      <button onClick={this.handleRetry} className="btn btn-primary">
                        Try Again
                      </button>
                      <button onClick={() => window.location.reload()} className="btn">
                        Reload App
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
