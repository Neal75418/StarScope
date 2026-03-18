import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompareTooltip } from "../CompareTooltip";

describe("CompareTooltip", () => {
  it("renders nothing when not active", () => {
    const { container } = render(
      <CompareTooltip active={false} payload={[]} label="2024-01-01" normalize={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when payload is empty", () => {
    const { container } = render(
      <CompareTooltip active={true} payload={[]} label="2024-01-01" normalize={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders date and entries", () => {
    render(
      <CompareTooltip
        active={true}
        payload={[
          { name: "facebook/react", value: 200000, color: "#2563eb" },
          { name: "vuejs/vue", value: 150000, color: "#dc2626" },
        ]}
        label="2024-01-01"
        normalize={false}
      />
    );
    expect(screen.getByText("2024-01-01")).toBeInTheDocument();
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
    expect(screen.getByText("200,000")).toBeInTheDocument();
    expect(screen.getByText("150,000")).toBeInTheDocument();
  });

  it("adds % suffix when normalized", () => {
    render(
      <CompareTooltip
        active={true}
        payload={[{ name: "facebook/react", value: 15.5, color: "#2563eb" }]}
        label="2024-01-01"
        normalize={true}
      />
    );
    expect(screen.getByText("15.5%")).toBeInTheDocument();
  });
});
