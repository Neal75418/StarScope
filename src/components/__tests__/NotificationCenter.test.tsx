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

vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        common: { loading: "Loading..." },
        notifications: {
          title: "Notifications",
          clear: "Clear",
          markAllRead: "Mark all as read",
          empty: "No notifications",
          viewAll: "View all",
          unread: "unread",
          justNow: "Just now",
          minutesAgo: "{n}m ago",
          hoursAgo: "{n}h ago",
          daysAgo: "{n}d ago",
        },
      },
    }),
  };
});

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
});
