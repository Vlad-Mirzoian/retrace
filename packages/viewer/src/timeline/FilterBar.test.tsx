import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterBar } from "./FilterBar.js";
import { ALL_FILTER_KINDS } from "./filter.js";

describe("FilterBar", () => {
  it("renders a chip for every filter kind and a search box", () => {
    render(
      <FilterBar
        activeKinds={ALL_FILTER_KINDS}
        onToggle={() => {}}
        onSetActiveKinds={() => {}}
        search=""
        onSearchChange={() => {}}
        shown={10}
        total={10}
      />,
    );
    expect(screen.getByRole("searchbox", { name: /search this session/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prompts" })).toBeInTheDocument();
  });

  it("marks active kinds as pressed and inactive ones as not", () => {
    const active = new Set(ALL_FILTER_KINDS);
    active.delete("tool");
    render(
      <FilterBar
        activeKinds={active}
        onToggle={() => {}}
        onSetActiveKinds={() => {}}
        search=""
        onSearchChange={() => {}}
        shown={1}
        total={2}
      />,
    );
    expect(screen.getByRole("button", { name: "Tools" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Prompts" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onToggle with the clicked kind", async () => {
    const onToggle = vi.fn();
    render(
      <FilterBar
        activeKinds={ALL_FILTER_KINDS}
        onToggle={onToggle}
        onSetActiveKinds={() => {}}
        search=""
        onSearchChange={() => {}}
        shown={1}
        total={1}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Errors" }));
    expect(onToggle).toHaveBeenCalledWith("error");
  });

  it("calls onSearchChange as the user types", async () => {
    const onSearchChange = vi.fn();
    render(
      <FilterBar
        activeKinds={ALL_FILTER_KINDS}
        onToggle={() => {}}
        onSetActiveKinds={() => {}}
        search=""
        onSearchChange={onSearchChange}
        shown={1}
        total={1}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "bug");
    expect(onSearchChange).toHaveBeenCalledWith("b");
  });

  it("shows the shown/total count", () => {
    render(
      <FilterBar
        activeKinds={ALL_FILTER_KINDS}
        onToggle={() => {}}
        onSetActiveKinds={() => {}}
        search=""
        onSearchChange={() => {}}
        shown={3}
        total={20}
      />,
    );
    expect(screen.getByText("3 / 20 events")).toBeInTheDocument();
  });

  describe("Failures only", () => {
    it("is not pressed when the active set isn't exactly {error}", () => {
      render(
        <FilterBar
          activeKinds={ALL_FILTER_KINDS}
          onToggle={() => {}}
          onSetActiveKinds={() => {}}
          search=""
          onSearchChange={() => {}}
          shown={1}
          total={1}
        />,
      );
      expect(screen.getByRole("button", { name: "Failures only" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("isolates errors when clicked from the full set", async () => {
      const onSetActiveKinds = vi.fn();
      render(
        <FilterBar
          activeKinds={ALL_FILTER_KINDS}
          onToggle={() => {}}
          onSetActiveKinds={onSetActiveKinds}
          search=""
          onSearchChange={() => {}}
          shown={1}
          total={1}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Failures only" }));
      expect(onSetActiveKinds).toHaveBeenCalledWith(new Set(["error"]));
    });

    it("is pressed and restores every kind when clicked again", async () => {
      const onSetActiveKinds = vi.fn();
      render(
        <FilterBar
          activeKinds={new Set(["error"])}
          onToggle={() => {}}
          onSetActiveKinds={onSetActiveKinds}
          search=""
          onSearchChange={() => {}}
          shown={1}
          total={1}
        />,
      );
      expect(screen.getByRole("button", { name: "Failures only" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await userEvent.click(screen.getByRole("button", { name: "Failures only" }));
      expect(onSetActiveKinds).toHaveBeenCalledWith(ALL_FILTER_KINDS);
    });
  });
});
