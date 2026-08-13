import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { RenameElementDialog } from "./RenameElementDialog";

// RenameElementDialogContent defers its initial name-field focus to a real
// requestAnimationFrame. trackAnimationFrames wraps the real rAF - it never
// runs a callback early || synchronously - so it can count every frame that
// gets scheduled && flush() only resolves once all of them have actually
// fired, inside act().
const trackAnimationFrames = () => {
  let pendingFrames = 0;
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const spy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingFrames += 1;
    return nativeRequestAnimationFrame((time) => {
      pendingFrames -= 1;
      callback(time);
    });
  });
  const flush = async () => {
    await act(async () => {
      while (pendingFrames > 0) {
        await new Promise<void>((resolve) => nativeRequestAnimationFrame(() => resolve()));
      }
    });
  };
  return { flush, restore: () => spy.mockRestore() };
};

const renderDialog = async (onConfirmed: ComponentProps<typeof RenameElementDialog>["onConfirmed"]) => {
  const frames = trackAnimationFrames();
  render(<RenameElementDialog onConfirmed={onConfirmed} />);
  try {
    await frames.flush();
  } finally {
    frames.restore();
  }
};

const seed = () => {
  // Written in nui 4's canonical vertical-call shape: renameElementWithPropagation's
  // dev assertion requires an in-place line patch (no inserted/removed lines).
  useCadDocumentStore.getState().commitText(
    ["nui 4", "point A = coordinate(", "  x: 0,", "  y: 0", ")", "point B = coordinate(", "  x: 10,", "  y: 0", ")"].join("\n"),
    "test"
  );
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
    await renderDialog(onConfirmed);
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

  it("does not focus the name field until the deferred frame actually runs", async () => {
    const { targetId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    const frames = trackAnimationFrames();
    try {
      render(<RenameElementDialog onConfirmed={onConfirmed} />);
      const input = screen.getByRole("textbox", { name: "名前" });
      expect(input).not.toHaveFocus();

      await frames.flush();
      expect(input).toHaveFocus();
    } finally {
      frames.restore();
    }
  });

  it("does not confirm Enter or close Esc while an IME composition is active", async () => {
    const { targetId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    await renderDialog(onConfirmed);
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

  it("cancels when the selected ID changes, independent of input focus", async () => {
    const { targetId, otherId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    await renderDialog(onConfirmed);
    const form = screen.getByRole("textbox", { name: "名前" }).closest("form")!;

    // Focus has no bearing on staleness; only the selected element ID does.
    act(() => { useCadUiStore.getState().setSelectedElementIds([otherId]); });
    fireEvent.submit(form);
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    expect(useCadUiStore.getState().commandErrorMessage).toContain("変更または削除");
    expect(onConfirmed).not.toHaveBeenCalled();

  });

  it("cancels when the snapshotted target disappears", async () => {
    const { targetId } = seed();
    useCadUiStore.getState().setRenameElementPromptTargetId(targetId);
    const onConfirmed = vi.fn();
    await renderDialog(onConfirmed);
    act(() => {
      useCadDocumentStore.setState({
        elements: useCadDocumentStore.getState().elements.filter((element) => element.id !== targetId)
      });
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
    await renderDialog(onConfirmed);
    fireEvent.submit(screen.getByRole("textbox", { name: "名前" }).closest("form")!);

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(targetId));
    expect(useCadDocumentStore.getState().past).toHaveLength(0);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === targetId)?.name).toBe("A");
  });
});
