import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DslEditor } from "./DslEditor";

describe("DslEditor", () => {
  it("renders line numbers for each source line", () => {
    render(<DslEditor source={"point A = (0, 0)\nline AB = A -> B"} onSourceChange={() => undefined} />);

    const gutter = document.querySelector(".dsl-line-numbers");
    expect(gutter).not.toBeNull();
    expect(within(gutter as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(gutter as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("renders highlighted token spans and updates source from textarea input", () => {
    const onSourceChange = vi.fn();
    render(<DslEditor source={"text label = \"前中心\" # comment"} onSourceChange={onSourceChange} />);

    expect(document.querySelector(".dsl-token-keyword")?.textContent).toBe("text");
    expect(document.querySelector(".dsl-token-string")?.textContent).toBe("\"前中心\"");
    expect(document.querySelector(".dsl-token-comment")?.textContent).toBe("# comment");

    fireEvent.change(screen.getByLabelText("DSLソース"), {
      target: { value: "point A = (0, 0)" }
    });

    expect(onSourceChange).toHaveBeenCalledWith("point A = (0, 0)");
  });

  it("marks export annotation comments and their following element lines", () => {
    render(
      <DslEditor
        source={"# @dsl-export: parent 親要素\ngroup front id=g expanded=true"}
        onSourceChange={() => undefined}
      />
    );

    const markedLines = document.querySelectorAll(".dsl-export-parent");
    expect(markedLines.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".dsl-line-numbers .dsl-export-parent")).toBeInTheDocument();
  });
});
