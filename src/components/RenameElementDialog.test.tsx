import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { RenameElementDialog } from "./RenameElementDialog";

const seed = () => {
  useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\npoint B = (10, 0)", "test");
  useCadDocumentStore.setState({ past: [], future: [], dirtySinceSave: false });
  const targetId = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!.id;
  const otherId = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!.id;
  useCadUiStore.getState().setSelectedElementIds([targetId]);
  return { targetId, otherId };
};

describe("RenameElementDialog", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => vi.restoreAllMocks());

  it("opens only for one selected element and clears an old command error", () => {
    const { targetId, otherId } = seed();
    useCadUiStore.getState().setCommandErrorMessage("古いエラー");

    expect(dispatchCommand("renameSelectedElement")).toBe(true);
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBe(targetId);
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();

    useCadUiStore.getState().setRenameElementPromptTargetId(null);
    useCadUiStore.getState().setSelectedElementIds([targetId, otherId]);
    expect(dispatchCommand("renameSelectedElement")).toBe(false);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("1件だけ");
  });

  it("keeps only the current rename rejection in the prompt, then retries successfully with one undo", async () => {
    const { targetId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    render(<RenameElementDialog onConfirmed={onConfirmed} />);
    const input = screen.getByRole("textbox", { name: "名前" }) as HTMLInputElement;

    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(1);
    fireEvent.change(input, { target: { value: "B" } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByRole("alert")).toHaveTextContent("同じ名前");
    expect(input).toHaveValue("B");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(targetId));
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    expect(useCadDocumentStore.getState().past).toHaveLength(1);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === targetId)?.name).toBe("A");
  });

  it("does not confirm Enter or close Esc while an IME composition is active", () => {
    const { targetId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    render(<RenameElementDialog onConfirmed={onConfirmed} />);
    const input = screen.getByRole("textbox", { name: "名前" });

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true, keyCode: 229 });
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBe(targetId);
    expect(onConfirmed).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
  });

  it("cancels when the selected ID changes, independent of input focus", () => {
    const { targetId, otherId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    render(<RenameElementDialog onConfirmed={onConfirmed} />);
    const form = screen.getByRole("textbox", { name: "名前" }).closest("form")!;

    // Focus has no bearing on staleness; only the selected element ID does.
    useCadUiStore.getState().setSelectedElementIds([otherId]);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    expect(useCadUiStore.getState().commandErrorMessage).toContain("変更または削除");
    expect(onConfirmed).not.toHaveBeenCalled();

  });

  it("cancels when the snapshotted target disappears", () => {
    const { targetId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    render(<RenameElementDialog onConfirmed={onConfirmed} />);
    useCadDocumentStore.setState({
      elements: useCadDocumentStore.getState().elements.filter((element) => element.id !== targetId)
    });

    fireEvent.submit(screen.getByRole("textbox", { name: "名前" }).closest("form")!);
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    expect(useCadUiStore.getState().commandErrorMessage).toContain("変更または削除");
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("closes a same-name success without creating a history entry", async () => {
    const { targetId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    render(<RenameElementDialog onConfirmed={onConfirmed} />);
    fireEvent.submit(screen.getByRole("textbox", { name: "名前" }).closest("form")!);

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(targetId));
    expect(useCadDocumentStore.getState().past).toHaveLength(0);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === targetId)?.name).toBe("A");
  });
});
