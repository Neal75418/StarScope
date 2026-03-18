import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { NavigationProvider, useNavigation } from "../NavigationContext";

function TestConsumer() {
  const { navigateTo, navigationState, consumeNavigationState } = useNavigation();
  return (
    <div>
      <button onClick={() => navigateTo("compare", { preselectedIds: [1, 2] })}>Go Compare</button>
      <button onClick={() => consumeNavigationState()}>Consume</button>
      <span data-testid="state">{JSON.stringify(navigationState)}</span>
    </div>
  );
}

describe("NavigationContext", () => {
  it("throws when used without provider", () => {
    expect(() => render(<TestConsumer />)).toThrow(
      "useNavigation must be used within NavigationProvider"
    );
  });

  it("calls onPageChange when navigateTo is called", async () => {
    const onPageChange = vi.fn();
    render(
      <NavigationProvider onPageChange={onPageChange}>
        <TestConsumer />
      </NavigationProvider>
    );

    await userEvent.click(screen.getByText("Go Compare"));
    expect(onPageChange).toHaveBeenCalledWith("compare");
  });

  it("sets navigationState when navigateTo is called with state", async () => {
    const onPageChange = vi.fn();
    render(
      <NavigationProvider onPageChange={onPageChange}>
        <TestConsumer />
      </NavigationProvider>
    );

    await userEvent.click(screen.getByText("Go Compare"));
    expect(screen.getByTestId("state")).toHaveTextContent(
      JSON.stringify({ preselectedIds: [1, 2] })
    );
  });

  it("clears navigationState after consumeNavigationState", async () => {
    const onPageChange = vi.fn();
    render(
      <NavigationProvider onPageChange={onPageChange}>
        <TestConsumer />
      </NavigationProvider>
    );

    await userEvent.click(screen.getByText("Go Compare"));
    expect(screen.getByTestId("state")).toHaveTextContent(
      JSON.stringify({ preselectedIds: [1, 2] })
    );

    await userEvent.click(screen.getByText("Consume"));
    expect(screen.getByTestId("state")).toHaveTextContent("null");
  });

  it("sets null state when navigateTo is called without state", async () => {
    const onPageChange = vi.fn();

    function NavNoState() {
      const { navigateTo, navigationState } = useNavigation();
      return (
        <div>
          <button onClick={() => navigateTo("trends")}>Go Trends</button>
          <span data-testid="state">{JSON.stringify(navigationState)}</span>
        </div>
      );
    }

    render(
      <NavigationProvider onPageChange={onPageChange}>
        <NavNoState />
      </NavigationProvider>
    );

    await userEvent.click(screen.getByText("Go Trends"));
    expect(onPageChange).toHaveBeenCalledWith("trends");
    expect(screen.getByTestId("state")).toHaveTextContent("null");
  });
});
