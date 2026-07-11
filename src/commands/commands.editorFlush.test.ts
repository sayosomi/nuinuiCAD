import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { dispatchCommand } from "./commands";

describe("dispatchCommand editor flush boundary", () => {
  let unregister = () => {};

  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => unregister());

  it("flushes pending editor text before running the command, applying one patch against the latest model", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");
    const elementId = useCadDocumentStore.getState().elements[0].id;
    useCadUiStore.getState().setSelectedElementIds([elementId]);

    let pending = true;
    const flush = vi.fn(() => {
      pending = false;
      // Simulates the editor committing a burst that moved point A right before the
      // command runs; the command must act on this text, not the pre-flush one.
      useCadDocumentStore.getState().commitText("nui 1\npoint A = (5, 5)", "editor");
      return "flushed" as const;
    });
    unregister = registerSourceEditSession({
      hasPendingText: () => pending,
      isComposing: () => false,
      flush
    });

    dispatchCommand("toggleSelectedElementVisibility");

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("command");
    const element = useCadDocumentStore.getState().elements[0];
    expect(element.id).toBe(elementId);
    expect(element).toMatchObject({ x: 5, y: 5, visible: false });
  });

  it("does not run the command when the flush is blocked by an active IME composition", () => {
    const flush = vi.fn(() => "blocked-composition" as const);
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush
    });
    const before = useCadDocumentStore.getState().sourceText;

    const result = dispatchCommand("toggleSelectedElementVisibility");

    expect(flush).toHaveBeenCalledWith("command");
    expect(result).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(before);
  });
});
