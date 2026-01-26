import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BackfillStatusBadge } from "../BackfillStatusBadge";

const mockT = {
  starHistory: {
    alreadyBackfilled: "Backfilled {days} days of history",
    eligible: "Eligible for backfill",
  },
};

describe("BackfillStatusBadge", () => {
  it("shows eligible message when has_backfilled_data is false", () => {
    render(
      <BackfillStatusBadge
        status={{ has_backfilled_data: false, can_backfill: true }}
        lastUpdated={null}
        lastUpdatedText=""
        t={mockT}
      />
    );

    expect(screen.getByText("Eligible for backfill")).toBeInTheDocument();
    expect(screen.getByText("Eligible for backfill")).toHaveClass("eligible");
  });

  it("shows backfilled message when has_backfilled_data is true", () => {
    render(
      <BackfillStatusBadge
        status={{ has_backfilled_data: true, backfilled_days: 30, can_backfill: false }}
        lastUpdated={null}
        lastUpdatedText=""
        t={mockT}
      />
    );

    expect(screen.getByText("Backfilled 30 days of history")).toBeInTheDocument();
    expect(screen.getByText("Backfilled 30 days of history")).toHaveClass("has-data");
  });

  it("shows last updated text when provided", () => {
    const lastUpdated = new Date("2024-01-15T12:00:00Z");
    render(
      <BackfillStatusBadge
        status={{ has_backfilled_data: false, can_backfill: true }}
        lastUpdated={lastUpdated}
        lastUpdatedText="5m ago"
        t={mockT}
      />
    );

    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toHaveAttribute("title", lastUpdated.toLocaleString());
  });

  it("does not show last updated when null", () => {
    const { container } = render(
      <BackfillStatusBadge
        status={{ has_backfilled_data: false, can_backfill: true }}
        lastUpdated={null}
        lastUpdatedText=""
        t={mockT}
      />
    );

    expect(container.querySelector(".backfill-last-updated")).not.toBeInTheDocument();
  });

  it("handles undefined backfilled_days gracefully", () => {
    render(
      <BackfillStatusBadge
        status={{ has_backfilled_data: true, can_backfill: false }}
        lastUpdated={null}
        lastUpdatedText=""
        t={mockT}
      />
    );

    expect(screen.getByText("Backfilled undefined days of history")).toBeInTheDocument();
  });
});
