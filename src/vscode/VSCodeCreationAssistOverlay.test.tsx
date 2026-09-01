import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { KeyboardEventHandler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { dispatchCommand } from "../commands/commands";
import { applyPickedLine, applyPickedPoint } from "../commands/pickCommands";
import {
  startCommandLineCreationForRecipe,
  syncCommandLinePickTarget
} from "../commands/commandLineSessionCommands";
import { startSession } from "../commands/commandLineSession";
import { creationRecipeForType } from "../commands/creationRecipes";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { VSCodeCreationAssistOverlay } from "./VSCodeCreationAssistOverlay";

const source = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 20, y: 0)",
  "line AB = segment(start: @A, end: @B)"
].join("\n");

const commandContext = {
  focusCanvas: vi.fn()
};

const renderOverlay = (
  postCanonicalSourceText = vi.fn(),
  onCanvasKeyDown?: KeyboardEventHandler<HTMLDivElement>
) => {
  const canvasFocusRef = createRef<HTMLDivElement>();
  const view = render(
    <div ref={canvasFocusRef} tabIndex={-1} onKeyDown={onCanvasKeyDown}>
      <VSCodeCreationAssistOverlay
        canvasFocusRef={canvasFocusRef}
        commandContext={commandContext}
        evaluation={evaluateElements(useCadDocumentStore.getState().elements)}
        postCanonicalSourceText={postCanonicalSourceText}
      />
    </div>
  );
  return { ...view, canvasFocusRef, postCanonicalSourceText };
};

const start = (type: Parameters<typeof startCommandLineCreationForRecipe>[0]["type"]) => {
  const recipe = creationRecipeForType(type);
  if (!recipe) throw new Error(`Missing recipe for ${type}`);
  act(() => { expect(startCommandLineCreationForRecipe(recipe)).toBe(true); });
};

const input = () => screen.getByRole<HTMLInputElement>("textbox");
const navigateButton = (index: number) =>
  screen.getByLabelText("Creation recipe steps").querySelectorAll("button")[index - 1] as HTMLButtonElement;

describe("VSCodeCreationAssistOverlay", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
    publishTestCanvasSelectionEligibility();
    commandContext.focusCanvas.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders only for a Canvas-origin document-end session", () => {
    const view = renderOverlay();
    expect(screen.queryByRole("form", { name: "VS Code creation assist" })).not.toBeInTheDocument();

    const recipe = creationRecipeForType("line")!;
    const document = useCadDocumentStore.getState();
    useCadUiStore.getState().startCommandLineSession(startSession(recipe, {
      insertionIndex: document.elements.length,
      revision: document.sourceRevision,
      elements: document.elements,
      sourceInsertionOrigin: "source-cursor",
      sourceInsertionLine: 2
    }));
    syncCommandLinePickTarget();
    expect(screen.queryByRole("form", { name: "VS Code creation assist" })).not.toBeInTheDocument();

    act(() => { useCadUiStore.getState().clearPickMode(); });
    start("line");
    expect(view.container.querySelector(".vscode-creation-assist-dock")).toBeInTheDocument();
  });

  it("starts at Name and always shows the complete numbered navigator", () => {
    renderOverlay();
    start("line");

    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Creation recipe steps").querySelectorAll("button")).toHaveLength(3);
    expect(input()).toHaveAttribute("aria-label", "名前");
    expect(navigateButton(1)).toHaveClass("is-active");
  });

  it("describes a default-bearing division ratio as blank when empty Enter advances", () => {
    renderOverlay();
    start("divisionPoint");
    fireEvent.click(navigateButton(4));

    expect(useCadUiStore.getState().commandLineSession?.recipe.steps[3]).toMatchObject({
      kind: "number",
      key: "ratio",
      default: "1"
    });
    expect(screen.getByText("空Enterで未指定のまま次へ進みます。")).toBeInTheDocument();
    expect(screen.queryByText("空Enterで 1 を採用します。")).not.toBeInTheDocument();
  });

  it("activates arbitrary steps without changing other supplied values or inventing filled state", () => {
    renderOverlay();
    start("freePoint");
    fireEvent.change(input(), { target: { value: "Point A" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "12" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(navigateButton(1)).toHaveClass("is-filled");
    expect(navigateButton(1).querySelector("[data-filled-marker='true']")).toBeInTheDocument();
    expect(navigateButton(2)).toHaveClass("is-filled");
    expect(navigateButton(2).querySelector("[data-filled-marker='true']")).toBeInTheDocument();
    expect(navigateButton(3)).not.toHaveClass("is-filled");
    expect(navigateButton(3).querySelector("[data-filled-marker='false']")).toBeInTheDocument();
    fireEvent.click(navigateButton(1));
    expect(input()).toHaveValue("Point A");
    expect(useCadUiStore.getState().commandLineSession?.args.x).toBe(12);
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("y");
  });

  it("uses roving focus and chip activation without claiming input keys", () => {
    renderOverlay();
    start("line");
    const first = navigateButton(1);
    const second = navigateButton(2);
    const third = navigateButton(3);
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(1);
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: " " });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(2);
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(third).toHaveAttribute("tabindex", "0");
  });

  it("uses Shift+Enter to enter shared pick without digit step jumps", () => {
    const { canvasFocusRef } = renderOverlay();
    start("freePoint");
    fireEvent.keyDown(input(), { key: "Enter" });
    const viewport = canvasFocusRef.current!;
    fireEvent.keyDown(viewport, { key: "Enter", shiftKey: true });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(1);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({ parameterKey: "x" });
    fireEvent.keyDown(viewport, { key: "3" });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(1);
  });

  it("clears a filled reference step through the session owner and refreshes its pick target", () => {
    renderOverlay();
    start("line");
    fireEvent.keyDown(input(), { key: "Enter" });
    const point = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    act(() => { useCadUiStore.getState().setActivePickCursor({ elementId: point.id, optionIndex: 0 }); });
    // The direct command path supplies the actual reference value.
    act(() => { applyPickedPoint({ pickedPointId: point.id }); });
    fireEvent.click(navigateButton(2));
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    act(() => { useCadUiStore.getState().setActivePickCursor({ elementId: point.id, optionIndex: 0 }); });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({ currentStepIndex: 1, args: {} });
    expect(useCadUiStore.getState().activePointPickTarget).toMatchObject({ parameterKey: "startPoint" });
    expect(useCadUiStore.getState().activePickCursor).toBeNull();
  });

  it("keeps digits typed in the input normal and completes modifier+Enter immediately", () => {
    const post = vi.fn();
    renderOverlay(post);
    start("freePoint");
    const nameInput = input();
    fireEvent.keyDown(nameInput, { key: "3" });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(0);
    fireEvent.keyDown(nameInput, { key: "Enter", metaKey: true });
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).not.toBe(source);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab as focus traversal and accepts a numeric suggestion with Enter", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "const Height: number = 20",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n"), "test");
    publishTestCanvasSelectionEligibility();
    renderOverlay();
    start("divisionPoint");
    fireEvent.click(navigateButton(4));
    const ratioInput = input();

    fireEvent.change(ratioInput, { target: { value: "@" } });
    ratioInput.setSelectionRange(1, 1);
    fireEvent.select(ratioInput);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("Height");

    fireEvent.keyDown(ratioInput, { key: "Tab" });
    expect(ratioInput).toHaveValue("@");
    expect(screen.getByRole("listbox", { name: "変数候補" })).toBeInTheDocument();
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(3);

    fireEvent.keyDown(ratioInput, { key: "Enter" });
    expect(ratioInput).toHaveValue("@Height");
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(3);
    fireEvent.keyDown(ratioInput, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
  });

  it("uses an explicit line-list Finish selection action and never modifier+Enter", () => {
    renderOverlay();
    start("offsetLine");
    fireEvent.keyDown(input(), { key: "Enter" });
    const line = useCadDocumentStore.getState().elements.find((element) => element.name === "AB")!;
    act(() => { applyPickedLine({ pickedLineId: line.id }); });
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).not.toBe(source);
    expect(screen.queryByRole("button", { name: "Finish selection" })).not.toBeInTheDocument();
  });

  it("cancels the whole session, shows Start again, and restarts from the current document", () => {
    renderOverlay();
    start("freePoint");
    const beforeRevision = useCadDocumentStore.getState().sourceRevision;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(screen.getByRole("button", { name: "Start again" })).toBeInTheDocument();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);

    useCadDocumentStore.getState().commitText(`${source}\npoint C = coordinate(x: 40, y: 0)`, "test");
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(useCadUiStore.getState().commandLineSession?.recipe.type).toBe("freePoint");
    expect(useCadUiStore.getState().commandLineSession?.startedAtRevision).toBeGreaterThan(beforeRevision);
    expect(useCadUiStore.getState().commandLineSession?.insertionIndex).toBe(useCadDocumentStore.getState().elements.length);
  });

  it("lets Canvas-owned Escape cancel only the shared pick and retain Canvas focus", () => {
    const dispatchCanvasPickCommand = vi.fn((commandId: "cancelPointPick") => {
      dispatchCommand(commandId);
    });
    const { canvasFocusRef } = renderOverlay(vi.fn(), (event) => {
      if (event.key === "Escape") dispatchCanvasPickCommand("cancelPointPick");
    });
    start("line");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession).not.toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toMatchObject({ parameterKey: "startPoint" });
    const canvas = canvasFocusRef.current!;
    canvas.focus();

    fireEvent.keyDown(canvas, { key: "Escape" });

    expect(dispatchCanvasPickCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCanvasPickCommand).toHaveBeenCalledWith("cancelPointPick");
    expect(useCadUiStore.getState().commandLineSession).not.toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(screen.queryByRole("button", { name: "Start again" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(canvas);
  });

  it("persists successful complete and draft creation exactly once on the final Enter", () => {
    const post = vi.fn();
    renderOverlay(post);
    start("freePoint");
    fireEvent.change(input(), { target: { value: "Created" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "1" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "2" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(useCadDocumentStore.getState().sourceText);

    const beforeDraftSource = useCadDocumentStore.getState().sourceText;
    start("freePoint");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(post).toHaveBeenCalledTimes(2);
    expect(useCadDocumentStore.getState().sourceText).not.toBe(beforeDraftSource);
  });

  it("dismisses Start again with Escape and returns focus to Canvas", () => {
    const { canvasFocusRef } = renderOverlay();
    start("line");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Start again" })).not.toBeInTheDocument();
    expect(commandContext.focusCanvas).toHaveBeenCalled();
    expect(canvasFocusRef.current).toBeInTheDocument();
  });
});
