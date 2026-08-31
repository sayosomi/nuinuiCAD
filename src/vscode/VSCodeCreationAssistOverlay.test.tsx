import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { applyPickedLine } from "../commands/pickCommands";
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

const renderOverlay = (postCanonicalSourceText = vi.fn()) => {
  const canvasFocusRef = createRef<HTMLDivElement>();
  const view = render(
    <div ref={canvasFocusRef} tabIndex={-1}>
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
    expect(navigateButton(2)).toHaveClass("is-filled");
    expect(navigateButton(3)).not.toHaveClass("is-filled");
    fireEvent.click(navigateButton(1));
    expect(input()).toHaveValue("Point A");
    expect(useCadUiStore.getState().commandLineSession?.args.x).toBe(12);
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("y");
  });

  it("routes Canvas digits and empty Enter through shared session semantics", () => {
    const { canvasFocusRef } = renderOverlay();
    start("freePoint");
    fireEvent.keyDown(input(), { key: "Enter" });
    const viewport = canvasFocusRef.current!;
    fireEvent.keyDown(viewport, { key: "Enter", shiftKey: true });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(0);
    fireEvent.keyDown(viewport, { key: "3" });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(2);

    start("line");
    fireEvent.keyDown(input(), { key: "Enter" });
    useCadUiStore.getState().setActivePickCursor({ elementId: "point-a", optionIndex: 0 });
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(2);
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("y");
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("startPoint");
  });

  it("keeps digits typed in the input normal and sends modifier+Enter to review", () => {
    const post = vi.fn();
    renderOverlay(post);
    start("freePoint");
    const nameInput = input();
    fireEvent.keyDown(nameInput, { key: "3" });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(0);
    fireEvent.keyDown(nameInput, { key: "Enter", metaKey: true });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(3);
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(post).not.toHaveBeenCalled();
  });

  it("closes a numeric suggestion after Tab and submits it on the next Enter", () => {
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
    expect(ratioInput).toHaveValue("@Height");
    expect(screen.queryByRole("listbox", { name: "変数候補" })).not.toBeInTheDocument();
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(3);

    fireEvent.keyDown(ratioInput, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(4);
    expect(useCadUiStore.getState().commandLineSession?.args.ratio).toEqual({
      kind: "expression",
      expression: "@Height"
    });
  });

  it("uses an explicit line-list Finish selection action and never modifier+Enter", () => {
    renderOverlay();
    start("offsetLine");
    fireEvent.keyDown(input(), { key: "Enter" });
    const line = useCadDocumentStore.getState().elements.find((element) => element.name === "AB")!;
    act(() => { applyPickedLine({ pickedLineId: line.id }); });
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(3);
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("baseLineIds");
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

  it("persists successful complete and draft creation exactly once, while rejected confirmation stays local", () => {
    const post = vi.fn();
    renderOverlay(post);
    start("freePoint");
    fireEvent.change(input(), { target: { value: "Created" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "1" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "2" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(useCadDocumentStore.getState().sourceText);

    const beforeDraftSource = useCadDocumentStore.getState().sourceText;
    start("freePoint");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(post).toHaveBeenCalledTimes(2);
    expect(useCadDocumentStore.getState().sourceText).not.toBe(beforeDraftSource);

    start("freePoint");
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    useCadUiStore.setState((state) => ({
      commandLineSession: state.commandLineSession
        ? { ...state.commandLineSession, sourceInsertionLine: null }
        : null
    }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(post).toHaveBeenCalledTimes(2);
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
