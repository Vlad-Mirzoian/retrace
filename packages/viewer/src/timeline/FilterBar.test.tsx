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
        search=""
        onSearchChange={() => {}}
        shown={3}
        total={20}
      />,
    );
    expect(screen.getByText("3 / 20 events")).toBeInTheDocument();
  });
});
