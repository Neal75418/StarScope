/**
 * GitHub connection component for OAuth Device Flow authentication.
 * Shows connection status and allows users to connect/disconnect GitHub account.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  initiateDeviceFlow,
  pollAuthorization,
  getGitHubConnectionStatus,
  disconnectGitHub,
  GitHubConnectionStatus,
  DeviceCodeResponse,
} from "../api/client";
import { getErrorMessage } from "../utils/error";

type ConnectionState =
  | "loading"
  | "disconnected"
  | "connecting"
  | "awaiting_auth"
  | "connected"
  | "error";

export function GitHubConnection() {
  const [state, setState] = useState<ConnectionState>("loading");
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pollStatus, setPollStatus] = useState<string>(""); // Show polling status to user

  const pollIntervalRef = useRef<number | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);
  const currentIntervalRef = useRef<number>(10); // Start with 10 seconds (GitHub minimum is 5)

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  // Fetch initial connection status
  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setState("loading");
    setError(null);

    try {
      const result = await getGitHubConnectionStatus();
      setStatus(result);
      setState(result.connected ? "connected" : "disconnected");
    } catch (err) {
      setError(getErrorMessage(err, "An error occurred"));
      setState("error");
    }
  };

  const startDeviceFlow = async () => {
    setState("connecting");
    setError(null);
    setPollStatus("");
    currentIntervalRef.current = 10; // Reset interval for new flow

    try {
      const result = await initiateDeviceFlow();
      setDeviceCode(result);
      setState("awaiting_auth");

      // Open browser to GitHub authorization page using Tauri opener
      try {
        await openUrl(result.verification_uri);
      } catch (openErr) {
        console.warn("Failed to open browser automatically:", openErr);
        // User can still click the manual link
      }

      // Start polling for authorization
      startPolling(result.device_code, result.interval, result.expires_in);
    } catch (err) {
      setError(getErrorMessage(err, "An error occurred"));
      setState("error");
    }
  };

  const startPolling = (code: string, interval: number, expiresIn: number) => {
    // Use at least 10 seconds to avoid rate limiting (GitHub default is 5, but we're conservative)
    currentIntervalRef.current = Math.max(interval, 10);
    console.warn(`[GitHubAuth] Starting polling: interval=${currentIntervalRef.current}s, expires=${expiresIn}s`);

    // Set expiration timeout
    pollTimeoutRef.current = window.setTimeout(() => {
      console.warn("[GitHubAuth] Polling expired");
      stopPolling();
      setError("Authorization expired. Please try again.");
      setState("disconnected");
      setDeviceCode(null);
    }, expiresIn * 1000);

    // The poll function that handles slow_down responses
    const doPoll = async () => {
      try {
        setPollStatus(`Checking... (next check in ${currentIntervalRef.current}s)`);
        console.warn(`[GitHubAuth] Polling... (interval: ${currentIntervalRef.current}s)`);
        const result = await pollAuthorization(code);
        console.warn("[GitHubAuth] Poll result:", result);

        if (result.status === "success") {
          console.warn("[GitHubAuth] Authorization successful!");
          setPollStatus("Connected!");
          stopPolling();
          setDeviceCode(null);
          setStatus({
            connected: true,
            username: result.username,
          });
          setState("connected");
        } else if (result.status === "expired" || result.status === "error") {
          console.warn("[GitHubAuth] Authorization failed:", result.error);
          setPollStatus("");
          stopPolling();
          setError(result.error || "Authorization failed");
          setState("disconnected");
          setDeviceCode(null);
        } else if (result.status === "pending" && result.slow_down && result.interval) {
          // GitHub says we're polling too fast - use their suggested interval + buffer
          const newInterval = result.interval + 5; // Add 5 second buffer to be safe
          console.warn(`[GitHubAuth] Slowing down: ${currentIntervalRef.current}s -> ${newInterval}s`);
          currentIntervalRef.current = newInterval;
          setPollStatus(`Rate limited, waiting ${newInterval}s...`);

          // Restart the interval with new timing
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = window.setInterval(doPoll, newInterval * 1000);
          }
        } else {
          // Regular pending - show next poll time
          setPollStatus(`Waiting for authorization... (checking every ${currentIntervalRef.current}s)`);
        }
      } catch (err) {
        // Network error during polling - continue trying
        console.error("[GitHubAuth] Poll error:", err);
        setPollStatus("Network error, retrying...");
      }
    };

    // Start first poll after 3 seconds (give user time to see the code)
    setTimeout(doPoll, 3000);

    // Then poll at regular intervals
    pollIntervalRef.current = window.setInterval(doPoll, currentIntervalRef.current * 1000);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  };

  const cancelAuth = () => {
    stopPolling();
    setDeviceCode(null);
    setPollStatus("");
    setState("disconnected");
  };

  const handleDisconnect = async () => {
    setState("loading");
    setError(null);

    try {
      await disconnectGitHub();
      setStatus(null);
      setState("disconnected");
    } catch (err) {
      setError(getErrorMessage(err, "An error occurred"));
      setState("error");
    }
  };

  const copyUserCode = useCallback(() => {
    if (deviceCode?.user_code) {
      navigator.clipboard.writeText(deviceCode.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [deviceCode]);

  const openGitHubManually = useCallback(async () => {
    if (deviceCode?.verification_uri) {
      try {
        await openUrl(deviceCode.verification_uri);
      } catch {
        // Fallback to window.open if Tauri opener fails
        window.open(deviceCode.verification_uri, "_blank");
      }
    }
  }, [deviceCode]);

  // Render based on state
  return (
    <div className="github-connection">
      <div className="section-header">
        <h3>GitHub Connection</h3>
      </div>

      {error && (
        <div className="github-error">
          {error}
          <button onClick={() => setError(null)} className="dismiss-btn">
            Dismiss
          </button>
        </div>
      )}

      {state === "loading" && (
        <div className="github-status loading">
          <div className="status-icon">
            <span className="spinner" />
          </div>
          <div className="status-text">Checking connection...</div>
        </div>
      )}

      {state === "disconnected" && (
        <div className="github-status disconnected">
          <div className="status-icon">
            <span className="icon-disconnected">!</span>
          </div>
          <div className="status-content">
            <div className="status-text">Not connected</div>
            <div className="status-hint">
              Connect to GitHub for higher API rate limits (5,000/hour vs 60/hour)
            </div>
          </div>
          <button onClick={startDeviceFlow} className="btn btn-primary">
            Connect GitHub
          </button>
        </div>
      )}

      {state === "connecting" && (
        <div className="github-status connecting">
          <div className="status-icon">
            <span className="spinner" />
          </div>
          <div className="status-text">Initiating connection...</div>
        </div>
      )}

      {state === "awaiting_auth" && deviceCode && (
        <div className="github-status awaiting">
          <div className="device-code-section">
            <div className="device-code-label">
              Enter this code on GitHub:
            </div>
            <div className="device-code-box">
              <code className="device-code">{deviceCode.user_code}</code>
              <button
                onClick={copyUserCode}
                className="btn btn-small"
                title="Copy code"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="device-code-hint">
              <span className="spinner-small" />
              {pollStatus || "Waiting for authorization..."}
            </div>
            <div className="device-code-warning">
              Please stay on this page until authorization is complete.
            </div>
            <div className="device-code-actions">
              <button onClick={openGitHubManually} className="btn btn-link">
                Open GitHub manually
              </button>
              <button onClick={cancelAuth} className="btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {state === "connected" && status && (
        <div className="github-status connected">
          <div className="status-icon">
            <span className="icon-connected">OK</span>
          </div>
          <div className="status-content">
            <div className="status-text">
              Connected as <strong>@{status.username}</strong>
            </div>
            {status.rate_limit_remaining !== undefined && (
              <div className="status-rate-limit">
                API: {status.rate_limit_remaining?.toLocaleString()} / {status.rate_limit_total?.toLocaleString()} remaining
              </div>
            )}
          </div>
          <button onClick={handleDisconnect} className="btn btn-danger">
            Disconnect
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="github-status error">
          <div className="status-icon">
            <span className="icon-error">X</span>
          </div>
          <div className="status-content">
            <div className="status-text">Connection error</div>
          </div>
          <button onClick={fetchStatus} className="btn">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
