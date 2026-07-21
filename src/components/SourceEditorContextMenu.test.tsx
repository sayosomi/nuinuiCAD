import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";

vi.mock("../commands/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../commands/commands")>();
  return { ...actual, dispatchCommand: vi.fn() };
});
import { dispatchCommand } from "../commands/commands";
import { SourceEditorContextMenu } from "./SourceEditorContextMenu";

describe("SourceEditorContextMenu", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");
    vi.mocked(dispatchCommand).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders menu items for the resolved element and closes after dispatching a command", () => {
    const elementId = useCadDocumentStore.getState().elements[0].id;
    const onClose = vi.fn();
    render(
      <SourceEditorContextMenu
        commandContext={{}}
        state={{ elementId, x: 10, y: 10 }}
        onClose={onClose}
      />
    );

    const toggleVisibility = screen.getByRole("menuitem", { name: "非表示にする" });
    fireEvent.click(toggleVisibility);

    expect(dispatchCommand).toHaveBeenCalledWith("setElementActivity", { elementId, activity: "hidden" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the elementId no longer resolves to an element", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SourceEditorContextMenu
        commandContext={{}}
        state={{ elementId: "nonexistent-id", x: 0, y: 0 }}
        onClose={onClose}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
