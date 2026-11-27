import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BackfillMessages } from "../BackfillMessages";
import type { TranslationKeys } from "../../i18n";

describe("BackfillMessages", () => {
  const defaultT = {
    starHistory: {
      offlineHint: "Data may be outdated",
      offlineLabel: "Offline",
    },
  } as unknown as TranslationKeys;

  it("renders nothing when all flags are false/null", () => {
    const { container } = render(
      <BackfillMessages
        isOffline={false}
        error={null}
        successMessage={null}
        warningMessage={null}
        t={defaultT}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows offline badge when isOffline is true", () => {
    render(
      <BackfillMessages
        isOffline={true}
        error={null}
        successMessage={null}
        warningMessage={null}
        t={defaultT}
      />
    );

    expect(screen.getByText(/Offline/)).toBeInTheDocument();
    expect(screen.getByText(/Offline/).closest("span")).toHaveClass("backfill-offline-badge");
  });

  it("shows error message when error is provided", () => {
    render(
      <BackfillMessages
        isOffline={false}
        error="Something went wrong"
        successMessage={null}
        warningMessage={null}
        t={defaultT}
      />
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toHaveClass("backfill-error");
  });

  it("shows an unclear outcome as a warning, not an error", () => {
    render(
      <BackfillMessages
        isOffline={false}
        error={null}
        successMessage={null}
        warningMessage="Unclear whether it finished"
        t={defaultT}
      />
    );
    const warning = screen.getByText("Unclear whether it finished");
    expect(warning).toHaveClass("backfill-warning");
    expect(warning).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows success message when successMessage is provided", () => {
    render(
      <BackfillMessages
        isOffline={false}
        error={null}
        successMessage="Backfill completed!"
        warningMessage={null}
        t={defaultT}
      />
    );

    expect(screen.getByText("Backfill completed!")).toBeInTheDocument();
    expect(screen.getByText("Backfill completed!")).toHaveClass("backfill-success");
  });

  it("shows multiple messages when multiple flags are true", () => {
    render(
      <BackfillMessages
        isOffline={true}
        error="Error occurred"
        successMessage="Success!"
        warningMessage={null}
        t={defaultT}
      />
    );

    expect(screen.getByText(/Offline/)).toBeInTheDocument();
    expect(screen.getByText("Error occurred")).toBeInTheDocument();
    expect(screen.getByText("Success!")).toBeInTheDocument();
  });

  it("has correct title attribute on offline badge", () => {
    render(
      <BackfillMessages
        isOffline={true}
        error={null}
        successMessage={null}
        warningMessage={null}
        t={defaultT}
      />
    );

    const badge = screen.getByText(/Offline/).closest("span");
    expect(badge).toHaveAttribute("title", "Data may be outdated");
  });
});
