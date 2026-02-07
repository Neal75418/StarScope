import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { NotificationCenter } from "../NotificationCenter";
import type { Notification } from "../../hooks/useNotifications";

const mockToggleOpen = vi.fn();
const mockClose = vi.fn();
const mockMarkAsRead = vi.fn();
const mockMarkAllAsRead = vi.fn();
const mockClearNotification = vi.fn();
const mockRefresh = vi.fn();

let mockReturnValue: {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  isOpen: boolean;
  toggleOpen: () => void;
  close: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearNotification: (id: string) => void;
  refresh: () => void;
};

vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => mockReturnValue,
}));


function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n-1",
    type: "alert",
    title: "Star spike",
    message: "react got 500 stars",
    timestamp: new Date().toISOString(),
    read: false,
    ...overrides,
  };
}

describe("NotificationCenter", () => {
  const mockOnNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockReturnValue = {
      notifications: [],
      unreadCount: 0,
      isLoading: false,
      error: null,
      isOpen: false,
      toggleOpen: mockToggleOpen,
      close: mockClose,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      clearNotification: mockClearNotification,
      refresh: mockRefresh,
    };
  });

  it("renders bell icon trigger button", () => {
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("does not show badge when unreadCount is 0", () => {
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument();
  });

  it("shows badge count when there are unread notifications", () => {
    mockReturnValue.unreadCount = 5;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows 99+ for badge when unread count exceeds 99", () => {
    mockReturnValue.unreadCount = 150;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("calls toggleOpen when trigger clicked", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    await user.click(screen.getByLabelText("Notifications"));
    expect(mockToggleOpen).toHaveBeenCalled();
  });

  it("shows dropdown when isOpen is true", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification()];
    mockReturnValue.unreadCount = 1;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Star spike")).toBeInTheDocument();
  });

  it("does not show dropdown when isOpen is false", () => {
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows empty message when no notifications and open", () => {
    mockReturnValue.isOpen = true;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });

  it("shows mark all as read button when there are unread", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.unreadCount = 2;
    mockReturnValue.notifications = [
      makeNotification({ id: "n-1" }),
      makeNotification({ id: "n-2" }),
    ];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByLabelText("Mark all as read")).toBeInTheDocument();
  });

  it("closes on Escape key press", () => {
    mockReturnValue.isOpen = true;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(mockClose).toHaveBeenCalled();
  });

  // --- New tests for uncovered branches ---

  it("shows loading state when loading with no notifications", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.isLoading = true;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("does not show loading when there are notifications even if loading", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.isLoading = true;
    mockReturnValue.notifications = [makeNotification()];
    mockReturnValue.unreadCount = 1;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByText("Star spike")).toBeInTheDocument();
  });

  it("shows view all footer when there are notifications", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification()];
    mockReturnValue.unreadCount = 1;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("View all notifications")).toBeInTheDocument();
  });

  it("does not show view all footer when list is empty", () => {
    mockReturnValue.isOpen = true;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.queryByText("View all notifications")).not.toBeInTheDocument();
  });

  it("does not show mark all as read when unreadCount is 0", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.unreadCount = 0;
    mockReturnValue.notifications = [makeNotification({ read: true })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.queryByLabelText("Mark all as read")).not.toBeInTheDocument();
  });

  it("calls markAllAsRead when button clicked", async () => {
    const user = userEvent.setup();
    mockReturnValue.isOpen = true;
    mockReturnValue.unreadCount = 1;
    mockReturnValue.notifications = [makeNotification()];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    await user.click(screen.getByLabelText("Mark all as read"));
    expect(mockMarkAllAsRead).toHaveBeenCalled();
  });

  it("calls markAsRead and navigates when unread notification clicked", async () => {
    const user = userEvent.setup();
    mockReturnValue.isOpen = true;
    mockReturnValue.unreadCount = 1;
    mockReturnValue.notifications = [
      makeNotification({
        id: "n-10",
        read: false,
        link: { page: "watchlist" },
      }),
    ];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    await user.click(screen.getByText("Star spike"));
    expect(mockMarkAsRead).toHaveBeenCalledWith("n-10");
    expect(mockClose).toHaveBeenCalled();
    expect(mockOnNavigate).toHaveBeenCalledWith("watchlist");
  });

  it("does not call markAsRead when already read notification clicked", async () => {
    const user = userEvent.setup();
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [
      makeNotification({
        id: "n-11",
        read: true,
        link: { page: "dashboard" },
      }),
    ];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    await user.click(screen.getByText("Star spike"));
    expect(mockMarkAsRead).not.toHaveBeenCalled();
    expect(mockOnNavigate).toHaveBeenCalledWith("dashboard");
  });

  it("does not navigate when notification has no link", async () => {
    const user = userEvent.setup();
    mockReturnValue.isOpen = true;
    mockReturnValue.unreadCount = 1;
    mockReturnValue.notifications = [makeNotification({ link: undefined })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    await user.click(screen.getByText("Star spike"));
    expect(mockMarkAsRead).toHaveBeenCalled();
    // onNavigate is not called since there's no target page
    expect(mockOnNavigate).not.toHaveBeenCalled();
  });

  it("clears notification when clear button clicked", async () => {
    const user = userEvent.setup();
    mockReturnValue.isOpen = true;
    mockReturnValue.unreadCount = 1;
    mockReturnValue.notifications = [makeNotification({ id: "n-20" })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    await user.click(screen.getByLabelText("Clear"));
    expect(mockClearNotification).toHaveBeenCalledWith("n-20");
  });

  it("renders alert notification icon", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification({ type: "alert" })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("!")).toBeInTheDocument();
  });

  it("renders signal notification icon", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification({ type: "signal" })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("⚡")).toBeInTheDocument();
  });

  it("renders system notification icon", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification({ type: "system" })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("ℹ")).toBeInTheDocument();
  });

  it("formats time as 'Just now' for recent notifications", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification()];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("Just now")).toBeInTheDocument();
  });

  it("formats time as minutes for slightly older notifications", () => {
    mockReturnValue.isOpen = true;
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockReturnValue.notifications = [makeNotification({ timestamp: fiveMinAgo })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("5 min ago")).toBeInTheDocument();
  });

  it("formats time as hours for older notifications", () => {
    mockReturnValue.isOpen = true;
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    mockReturnValue.notifications = [makeNotification({ timestamp: threeHoursAgo })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("3 hr ago")).toBeInTheDocument();
  });

  it("formats time as days for notifications older than 24h", () => {
    mockReturnValue.isOpen = true;
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockReturnValue.notifications = [makeNotification({ timestamp: twoDaysAgo })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    expect(screen.getByText("2 days ago")).toBeInTheDocument();
  });

  it("closes on click outside", () => {
    mockReturnValue.isOpen = true;
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <NotificationCenter onNavigate={mockOnNavigate} />
      </div>
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(mockClose).toHaveBeenCalled();
  });

  it("does not close on Escape when already closed", () => {
    mockReturnValue.isOpen = false;
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("navigates to dashboard when 'View all' is clicked", async () => {
    const user = userEvent.setup();
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification()];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    await user.click(screen.getByText("View all notifications"));
    expect(mockClose).toHaveBeenCalled();
    expect(mockOnNavigate).toHaveBeenCalledWith("dashboard");
  });

  it("applies 'unread' class to unread notifications", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification({ read: false })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    const item = screen.getByText("Star spike").closest(".notification-item");
    expect(item).toHaveClass("unread");
  });

  it("applies 'read' class to read notifications", () => {
    mockReturnValue.isOpen = true;
    mockReturnValue.notifications = [makeNotification({ read: true })];
    render(<NotificationCenter onNavigate={mockOnNavigate} />);
    const item = screen.getByText("Star spike").closest(".notification-item");
    expect(item).toHaveClass("read");
  });
});
