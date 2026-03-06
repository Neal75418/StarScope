import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectionDisconnected } from "../ConnectionDisconnected";
import { ConnectionAwaitingAuth } from "../ConnectionAwaitingAuth";
import { ConnectionError } from "../ConnectionError";
import { ErrorBanner } from "../ErrorBanner";

describe("ConnectionDisconnected", () => {
  it("renders not connected message and connect button", () => {
    const onConnect = vi.fn();
    render(<ConnectionDisconnected onConnect={onConnect} />);

    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Connect GitHub")).toBeInTheDocument();
  });

  it("calls onConnect when button is clicked", () => {
    const onConnect = vi.fn();
    render(<ConnectionDisconnected onConnect={onConnect} />);

    fireEvent.click(screen.getByText("Connect GitHub"));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});

describe("ConnectionAwaitingAuth", () => {
  const defaultProps = {
    deviceCode: {
      user_code: "ABCD-1234",
      device_code: "device-code",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    },
    pollStatus: "",
    copied: false,
    onCopy: vi.fn(),
    onOpenManually: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders the device code", () => {
    render(<ConnectionAwaitingAuth {...defaultProps} />);

    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
  });

  it("shows copy button", () => {
    render(<ConnectionAwaitingAuth {...defaultProps} />);

    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("shows copied state when copied is true", () => {
    render(<ConnectionAwaitingAuth {...defaultProps} copied={true} />);

    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });

  it("calls onCopy when copy button is clicked", () => {
    const onCopy = vi.fn();
    render(<ConnectionAwaitingAuth {...defaultProps} onCopy={onCopy} />);

    fireEvent.click(screen.getByText("Copy"));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConnectionAwaitingAuth {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenManually when link is clicked", () => {
    const onOpenManually = vi.fn();
    render(<ConnectionAwaitingAuth {...defaultProps} onOpenManually={onOpenManually} />);

    fireEvent.click(screen.getByText("Open GitHub manually"));
    expect(onOpenManually).toHaveBeenCalledTimes(1);
  });

  it("shows poll status when provided", () => {
    render(<ConnectionAwaitingAuth {...defaultProps} pollStatus="Checking..." />);

    expect(screen.getByText("Checking...")).toBeInTheDocument();
  });
});

describe("ConnectionError", () => {
  it("renders error message and retry button", () => {
    const onRetry = vi.fn();
    render(<ConnectionError onRetry={onRetry} />);

    expect(screen.getByText("Connection error")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("calls onRetry when button is clicked", () => {
    const onRetry = vi.fn();
    render(<ConnectionError onRetry={onRetry} />);

    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorBanner", () => {
  it("renders error message", () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner error="Something went wrong" onDismiss={onDismiss} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner error="Error" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
