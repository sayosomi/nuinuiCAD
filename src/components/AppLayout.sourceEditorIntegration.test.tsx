import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  cancelCommandLineSession,
  startCommandLineCreation,
  startCommandLineCreationForRecipe,
  startCommandLineStepEdit
} from "../commands/commandLineSessionCommands";
import { applyPickedPoint } from "../commands/pickCommands";
import { referenceAnchor } from "../model/pointAnchors";
import type { CreationRecipe } from "../commands/creationRecipes";
import { AppLayout } from "./AppLayout";

// Written in v2's canonical vertical-call shape (matching dslTextForElements'
// real output) so any in-place rename/patch in these tests doesn't need to
// expand a compact statement to canonical shape mid-test.
const source = [
  "nui 2",
  "group G {",
  "  point A = coordinate(",
  "    x: 0",
  "    y: 0",
  "  )",
  "  point B = coordinate(",
  "    x: 100",
  "    y: 0",
  "  )",
  "}"
].join("\n");

const canvasContext = () => ({
  arc: vi.fn(), bezierCurveTo: vi.fn(), beginPath: vi.fn(), clearRect: vi.fn(), fill: vi.fn(),
  fillRect: vi.fn(), lineTo: vi.fn(), moveTo: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), stroke: vi.fn()
});

beforeEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
  useCadDocumentStore.getState().commitText(source, "test");
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 500 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
  // A `.cm-line` reporting the full 400px viewport height (like every other
  // stubbed element) misleads CodeMirror's own viewport-height estimate into
  // thinking only ~1 line fits, which can transiently affect how much of a
  // patched line's content gets measured/rendered. Give lines a small,
  // realistic height instead so CM's real (unmodified) viewport logic sees
  // something plausible.
  const CM_LINE_HEIGHT_PX = 18;
  HTMLElement.prototype.getBoundingClientRect = vi.fn(function (this: HTMLElement) {
    if (this.classList.contains("cm-line")) {
      return {
        x: 0, y: 0, top: 0, left: 0, right: 500, bottom: CM_LINE_HEIGHT_PX,
        width: 500, height: CM_LINE_HEIGHT_PX, toJSON: () => ({})
      };
    }
    return { x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 400, width: 500, height: 400, toJSON: () => ({}) };
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext() as unknown as CanvasRenderingContext2D);
  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target } as ResizeObserverEntry], this); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

const pointId = (name: string) => {
  const id = useCadDocumentStore.getState().elements.find((element) => element.name === name)?.id;
  if (!id) throw new Error(`Missing point ${name}`);
  return id;
};

/**
 * The real CodeMirror document text, not the rendered `.cm-content` DOM's
 * `textContent`. CM virtualizes/decorates its DOM, so a partially-rendered
 * viewport (or a transient decoration artifact) can make `textContent` read
 * as an incomplete or misleading stand-in for "what the document contains" -
 * `EditorView.state.doc` is the actual source of truth.
 */
const editorDocText = (container: HTMLElement): string => {
  const editorElement = container.querySelector<HTMLElement>(".cm-editor");
  const cmView = editorElement ? EditorView.findFromDOM(editorElement) : null;
  if (!cmView) throw new Error("Missing CodeMirror view");
  return cmView.state.doc.toString();
};

const midSessionLineListRecipe: CreationRecipe = {
  type: "copyLine",
  steps: [
    { kind: "point", key: "startPoint", prompt: "始点" },
    { kind: "lineList", key: "baseLineIds", prompt: "基準線" },
    { kind: "name", autoSuggest: true }
  ]
};

describe("AppLayout Source Editor production integration", () => {
  it("derives line-list inert regions from the virtual target without disabling the command bar", async () => {
    const view = render(<AppLayout />);
    const sourcePane = view.container.querySelector<HTMLElement>(".source-editor-pane-wrapper")!;
    const rightPanel = view.container.querySelector<HTMLElement>(".right-panel")!;
    const resizeHandle = view.container.querySelector<HTMLElement>(".left-panel-resize-handle")!;
    const commandBar = () => view.container.querySelector<HTMLElement>(".command-line-bar");

    act(() => { startCommandLineCreation("offsetLine"); });
    await waitFor(() => expect(useCadUiStore.getState().activeLinePickTarget).toMatchObject({
      elementId: "__command-line__",
      draftLineIds: []
    }));
    expect(sourcePane).toHaveAttribute("inert");
    expect(rightPanel).toHaveAttribute("inert");
    expect(resizeHandle).toHaveAttribute("inert");
    expect(commandBar()).not.toBeNull();
    expect(commandBar()).not.toHaveAttribute("inert");

    act(() => { cancelCommandLineSession(); });
    await waitFor(() => expect(sourcePane).not.toHaveAttribute("inert"));
    expect(rightPanel).not.toHaveAttribute("inert");
    expect(resizeHandle).not.toHaveAttribute("inert");
    expect(document.activeElement?.closest("[inert]")).toBeNull();
  });

  it("restores line-list inert mode and Canvas focus after global Escape cancels a mid-session chip edit", async () => {
    const view = render(<AppLayout />);
    const sourcePane = view.container.querySelector<HTMLElement>(".source-editor-pane-wrapper")!;
    const canvas = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;

    act(() => {
      startCommandLineCreationForRecipe(midSessionLineListRecipe);
      applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointId("A")) });
    });
    await waitFor(() => expect(sourcePane).toHaveAttribute("inert"));

    act(() => { startCommandLineStepEdit(0); });
    await waitFor(() => expect(sourcePane).not.toHaveAttribute("inert"));
    expect(view.getByRole("textbox", { name: "始点" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(sourcePane).toHaveAttribute("inert"));
    await waitFor(() => expect(canvas).toHaveFocus());
    expect(document.activeElement?.closest("[inert]")).toBeNull();
  });

  it("replaces a line-list pick session through a modified normal creation shortcut without accepting plain typing", async () => {
    useCadUiStore.setState({
      shortcutSettings: {
        version: 1,
        overrides: [{
          bindingId: "normal.addLine",
          chords: [{ key: "l", mod: true, alt: false, shift: false }]
        }]
      }
    });
    const view = render(<AppLayout />);
    act(() => { startCommandLineCreation("offsetLine"); });
    const input = view.getByPlaceholderText("候補名を入力") as HTMLInputElement;
    const sourcePane = view.container.querySelector<HTMLElement>(".source-editor-pane-wrapper")!;

    act(() => { fireEvent.keyDown(input, { key: "x" }); });
    expect(useCadUiStore.getState().commandLineSession?.recipe.type).toBe("offsetLine");

    act(() => { fireEvent.keyDown(input, { key: "l", metaKey: true }); });
    await waitFor(() => expect(useCadUiStore.getState().commandLineSession?.recipe.type).toBe("line"));
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toMatchObject({
      elementId: "__command-line__",
      parameterKey: "startPoint"
    });
    expect(sourcePane).not.toHaveAttribute("inert");
  });

  it("leaves a modified creation shortcut to the Command Palette input even while a session exists", async () => {
    useCadUiStore.setState({
      shortcutSettings: {
        version: 1,
        overrides: [{
          bindingId: "normal.addLine",
          chords: [{ key: "c", mod: true, alt: false, shift: false }]
        }]
      }
    });
    const view = render(<AppLayout />);
    act(() => { startCommandLineCreation("variable"); });
    act(() => { useCadUiStore.getState().setShowCommandPalette(true); });
    const input = view.getByRole("textbox", { name: "コマンドを検索" });

    const event = fireEvent.keyDown(input, { key: "c", metaKey: true });

    expect(event).toBe(true);
    expect(useCadUiStore.getState().commandLineSession?.recipe.type).toBe("variable");
    expect(useCadUiStore.getState().showCommandPalette).toBe(true);
  });

  it("leaves a modified creation shortcut to the Command Palette input when no session exists", () => {
    useCadUiStore.setState({
      shortcutSettings: {
        version: 1,
        overrides: [{
          bindingId: "normal.addLine",
          chords: [{ key: "c", mod: true, alt: false, shift: false }]
        }]
      },
      showCommandPalette: true
    });
    const view = render(<AppLayout />);
    const input = view.getByRole("textbox", { name: "コマンドを検索" });

    const event = fireEvent.keyDown(input, { key: "c", metaKey: true });

    expect(event).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
  });

  it("confirms from the real bar and returns focus to the existing Source Editor selection path", async () => {
    const view = render(<AppLayout />);
    act(() => { startCommandLineCreation("variable"); });
    const input = view.getByRole("textbox", { name: "式" }) as HTMLInputElement;
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.click(view.getByRole("button", { name: "スキップ" }));
    fireEvent.submit(form);

    await waitFor(() => expect(useCadUiStore.getState().commandLineSession).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(view.container.querySelector(".cm-content")));
    expect(useCadDocumentStore.getState().elements.at(-1)).toMatchObject({ type: "variable" });
  });

  it("renames through F2, suppresses the shortcut in the prompt input, and returns to the target line", async () => {
    const view = render(<AppLayout />);
    const targetId = pointId("A");
    act(() => { useCadUiStore.getState().setSelectedElementIds([targetId]); });
    const historyBefore = useCadDocumentStore.getState().past.length;

    fireEvent.keyDown(window, { key: "F2" });
    const input = await view.findByRole("textbox", { name: "名前" });
    expect(input).toHaveValue("A");
    fireEvent.change(input, { target: { value: "Tentative" } });
    fireEvent.keyDown(input, { key: "F2" });
    expect(input).toHaveValue("Tentative");
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBe(targetId);

    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(view.container.querySelector(".cm-content")));
    expect(useCadUiStore.getState().selectedElementId).toBe(targetId);
    expect(editorDocText(view.container)).toContain("point Renamed");
    expect(useCadDocumentStore.getState().past).toHaveLength(historyBefore + 1);
    act(() => { useCadDocumentStore.getState().undo(); });
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === targetId)?.name).toBe("A");
  });

  it("blocks bar IME Enter/Escape and global single-key dispatch, then resumes after compositionend", () => {
    const view = render(<AppLayout />);
    act(() => { startCommandLineCreation("variable"); });
    const input = view.getByRole("textbox", { name: "式" }) as HTMLInputElement;
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "未確定" } });
    const session = useCadUiStore.getState().commandLineSession;
    const sourceRevision = useCadDocumentStore.getState().sourceRevision;

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true, keyCode: 229 });
    fireEvent.keyDown(input, { key: "x", isComposing: true, keyCode: 229 });
    expect(useCadUiStore.getState().commandLineSession).toBe(session);
    expect(input).toHaveValue("未確定");

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "x" });
    expect(useCadDocumentStore.getState().sourceRevision).toBe(sourceRevision);
    expect(useCadUiStore.getState().commandLineSession).toBe(session);

    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({ currentStepIndex: 1 });
  });

  it("uses global Escape to cancel only a mid-session edit, but cancels completed and normal sessions", async () => {
    const view = render(<AppLayout />);
    act(() => { startCommandLineCreation("freePoint"); });
    const input = view.getByRole("textbox", { name: "x" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.submit(input.closest("form")!);
    act(() => { startCommandLineStepEdit(0); });

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: null,
      args: { x: 3 }
    }));

    act(() => { cancelCommandLineSession(); startCommandLineCreation("variable"); });
    const expression = view.getByRole("textbox", { name: "式" }) as HTMLInputElement;
    fireEvent.change(expression, { target: { value: "3" } });
    fireEvent.submit(expression.closest("form")!);
    fireEvent.click(view.getByRole("button", { name: "スキップ" }));
    fireEvent.click(view.getByRole("button", { name: "式を編集" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(useCadUiStore.getState().commandLineSession).toBeNull());

    act(() => { startCommandLineCreation("variable"); });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(useCadUiStore.getState().commandLineSession).toBeNull());
  });

  it("delegates Escape from the real bar input to the bar exactly once", async () => {
    const view = render(<AppLayout />);
    act(() => { startCommandLineCreation("freePoint"); });
    const xInput = view.getByRole("textbox", { name: "x" }) as HTMLInputElement;
    fireEvent.change(xInput, { target: { value: "3" } });
    fireEvent.submit(xInput.closest("form")!);
    act(() => { startCommandLineStepEdit(0); });
    const editingXInput = view.getByRole("textbox", { name: "x" });
    await waitFor(() => expect(editingXInput).toHaveFocus());

    fireEvent.keyDown(editingXInput, { key: "Escape" });
    await waitFor(() => expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: null,
      args: { x: 3 }
    }));

    act(() => { cancelCommandLineSession(); startCommandLineCreation("variable"); });
    const expression = view.getByRole("textbox", { name: "式" }) as HTMLInputElement;
    fireEvent.change(expression, { target: { value: "3" } });
    fireEvent.submit(expression.closest("form")!);
    fireEvent.click(view.getByRole("button", { name: "スキップ" }));
    fireEvent.click(view.getByRole("button", { name: "式を編集" }));
    const editingExpression = view.getByRole("textbox", { name: "式" });
    await waitFor(() => expect(editingExpression).toHaveFocus());
    fireEvent.keyDown(editingExpression, { key: "Escape" });
    await waitFor(() => expect(useCadUiStore.getState().commandLineSession).toBeNull());

    act(() => { startCommandLineCreation("variable"); });
    const normalExpression = view.getByRole("textbox", { name: "式" });
    await waitFor(() => expect(normalExpression).toHaveFocus());
    fireEvent.keyDown(normalExpression, { key: "Escape" });
    await waitFor(() => expect(useCadUiStore.getState().commandLineSession).toBeNull());
  });

  it("uses the real Canvas and controller for Canvas⇄cursor sync and folded descendants", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const groupId = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!.id;
    act(() => useCadUiStore.getState().setGroupFold(groupId, { expanded: false }));

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });

    await waitFor(() => expect(useCadUiStore.getState().selectedElementId).toBe(pointId("B")));
    expect(useCadUiStore.getState().sourceCursorLine).toBe(7);
    expect(useCadUiStore.getState().groupFoldById.get(groupId)?.expanded).toBe(true);

  });

  it("keeps cursor selection through a model patch and exposes command errors in the real pane", async () => {
    // This test only ever locks B via commitDocumentChange (never renames), so
    // it doesn't need the shared fixture's canonical vertical shape - using a
    // compact one keeps it consistent with its own original (pre-C1) size.
    useCadDocumentStore.getState().commitText(
      ["nui 2", "group G {", "  point A = coordinate(x: 0 y: 0)", "  point B = coordinate(x: 100 y: 0)", "}"].join("\n"),
      "test"
    );
    const view = render(<AppLayout />);
    const pointB = pointId("B");
    act(() => { useCadUiStore.getState().setSelectedElementId(pointB); });
    await waitFor(() => expect(useCadUiStore.getState().sourceCursorLine).toBe(4));
    const beforeCursorLine = useCadUiStore.getState().sourceCursorLine;

    act(() => {
      const elements = useCadDocumentStore.getState().elements.map((element) =>
        element.id === pointB ? { ...element, locked: true } : element
      );
      useCadDocumentStore.getState().commitDocumentChange({ elements });
      useCadUiStore.getState().setCommandErrorMessage("統合テストのエラー");
    });

    await waitFor(() => expect(editorDocText(view.container)).toContain("locked: true"));
    expect(useCadUiStore.getState().sourceCursorLine).toBe(beforeCursorLine);
    expect(view.getByRole("alert")).toHaveTextContent("統合テストのエラー");
  });

  it("renders pickable-only search in the real Source Editor pane", async () => {
    const view = render(<AppLayout />);
    const pointB = pointId("B");
    useCadUiStore.getState().setActivePointPickTarget({ elementId: pointB, parameterKey: "fromPoint" as never });
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    viewport.focus();
    fireEvent.keyDown(window, { key: "f", metaKey: true });

    const checkbox = await view.findByLabelText("選択可能のみ");
    fireEvent.click(checkbox);
    expect(useCadUiStore.getState().elementSearchPickableOnly).toBe(true);
  });

  it("applies a dirty drag through the real editor flush and the fresh evaluation", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const cmView = EditorView.findFromDOM(view.container.querySelector<HTMLElement>(".cm-editor")!)!;

    // Uncommitted editor text at gesture time: the canvas must defer to the
    // real flush and resolve against the freshly evaluated document.
    act(() => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: "\npoint C = coordinate(x: 0 y: 60)" } });
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 400, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 400, clientY: 190, pointerId: 1 });

    await waitFor(() => {
      const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B");
      expect(pointB).toMatchObject({ x: 150, y: 10 });
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(pointId("B"));
    expect(useCadDocumentStore.getState().sourceText).toContain("point C");
    const pointC = useCadDocumentStore.getState().elements.find((element) => element.name === "C");
    expect(pointC).toMatchObject({ x: 0, y: 60 });
  });

  it("rejects canvas gestures during IME composition and recovers after compositionend", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const content = view.container.querySelector<HTMLElement>(".cm-content")!;
    const cmView = EditorView.findFromDOM(view.container.querySelector<HTMLElement>(".cm-editor")!)!;

    fireEvent.compositionStart(content);
    act(() => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: "\npoint 未確定 = coordinate(x: 0 y: 60)" } });
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    expect(view.getByRole("alert")).toHaveTextContent("日本語入力の確定中");
    expect(useCadUiStore.getState().selectedElementId).not.toBe(pointId("B"));

    fireEvent.compositionEnd(content);
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 2 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 350, clientY: 200, pointerId: 2 });

    await waitFor(() => expect(useCadUiStore.getState().selectedElementId).toBe(pointId("B")));
    expect(useCadDocumentStore.getState().sourceText).toContain("未確定");
  });

  it("applies a pick candidate from search Enter through the real controller", async () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)",
      "point 選択候補 = coordinate(x: 0 y: -50)",
      "line AB = segment(start: A end: B)"
    ].join("\n"), "test");
    const view = render(<AppLayout />);
    const lineId = useCadDocumentStore.getState().elements.find((element) => element.name === "AB")!.id;
    const pickCandidate = pointId("選択候補");
    act(() => {
      useCadUiStore.getState().setActivePointPickTarget({ elementId: lineId, parameterKey: "startPoint" });
    });

    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    viewport.focus();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const input = await view.findByLabelText("要素を検索");
    fireEvent.change(input, { target: { value: "選択候補" } });
    await view.findByRole("button", { name: "選択候補" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const lineElement = useCadDocumentStore.getState().elements.find((element) => element.name === "AB");
      expect(lineElement).toMatchObject({ startPoint: { mode: "reference", pointId: pickCandidate } });
    });
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
  });

});

describe("Canvas selection focuses the Source Editor", () => {
  const focusSource = [
    "nui 2",
    "point A = coordinate(x: 0 y: 0)",
    "point B = coordinate(x: 100 y: 0)",
    "line AB = segment(start: A end: B)"
  ].join("\n");

  // worldToScreen with the default {panX:0, panY:0, zoom:1} viewport and the
  // 500x400 stubbed .canvas-viewport maps A(0,0)->(250,200), B(100,0)->(350,200),
  // and the AB midpoint (50,0)->(300,200): 50px from either point, so it hits the
  // line segment (6px tolerance) rather than either point (8px tolerance).
  const B_SCREEN = { clientX: 350, clientY: 200 };
  const AB_MIDPOINT_SCREEN = { clientX: 300, clientY: 200 };
  const BLANK_SCREEN = { clientX: 100, clientY: 350 };

  const setUp = () => {
    useCadDocumentStore.getState().commitText(focusSource, "test");
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const content = view.container.querySelector<HTMLElement>(".cm-content")!;
    const cmView = EditorView.findFromDOM(view.container.querySelector<HTMLElement>(".cm-editor")!)!;
    const elementId = (name: string) =>
      useCadDocumentStore.getState().elements.find((element) => element.name === name)!.id;
    return { view, viewport, content, cmView, elementId };
  };

  it("keeps Canvas focus while a simple click settles, then focuses the editor on pointerup", async () => {
    const { viewport, content } = setUp();

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...AB_MIDPOINT_SCREEN });
    expect(document.activeElement).not.toBe(content);

    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 1, ...AB_MIDPOINT_SCREEN });
    await waitFor(() => expect(document.activeElement).toBe(content));
    expect(useCadUiStore.getState().sourceCursorLine).toBe(4);
  });

  it("supports Canvas selection -> editor focus -> Tab/Shift-Tab -> Alt+Arrow editing", async () => {
    const { viewport, content, cmView } = setUp();

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...B_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 1, ...B_SCREEN });
    await waitFor(() => expect(document.activeElement).toBe(content));

    fireEvent.keyDown(content, { key: "Tab" });
    expect(cmView.state.sliceDoc(cmView.state.selection.main.from, cmView.state.selection.main.to)).toBe("100");
    fireEvent.keyDown(content, { key: "Tab" });
    expect(cmView.state.sliceDoc(cmView.state.selection.main.from, cmView.state.selection.main.to)).toBe("0");
    fireEvent.keyDown(content, { key: "Tab", shiftKey: true });
    expect(cmView.state.sliceDoc(cmView.state.selection.main.from, cmView.state.selection.main.to)).toBe("100");

    fireEvent.keyDown(content, { key: "ArrowRight", altKey: true });
    fireEvent.keyUp(content, { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(useCadDocumentStore.getState().sourceText).toContain("x: 101"));
  });

  it("keeps Canvas focus through a point drag and focuses the editor only after the move commits", async () => {
    const { viewport, content, elementId } = setUp();

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...B_SCREEN });
    expect(useCadUiStore.getState().selectedElementId).toBe(elementId("B"));
    expect(document.activeElement).toBe(viewport);

    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 1, clientX: 380, clientY: 190 });
    expect(document.activeElement).toBe(viewport);

    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 1, clientX: 380, clientY: 190 });
    await waitFor(() => expect(document.activeElement).toBe(content));
    // Cursor placement after this focus() goes through restoreDeferredExternalCursor
    // (the drag ran while the editor was unfocused), which re-reads the DOM selection
    // through CodeMirror's DOM observer; jsdom's Range/getClientRects support is too
    // limited to assert an exact offset here, so this only checks the focus handoff.
  });

  it("does not move focus for a blank click", () => {
    const { viewport, content } = setUp();
    const previouslySelected = useCadUiStore.getState().selectedElementId;

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...BLANK_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 1, ...BLANK_SCREEN });

    expect(useCadUiStore.getState().selectedElementId).toBe(previouslySelected);
    expect(document.activeElement).not.toBe(content);
  });

  it("discards the focus reservation on pointer cancel instead of moving focus", () => {
    const { viewport, content } = setUp();

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...B_SCREEN });
    fireEvent.pointerCancel(viewport, { pointerId: 1, ...B_SCREEN });

    expect(document.activeElement).not.toBe(content);
  });

  it("focuses the editor once a click resolves after evaluation catches up", async () => {
    const { viewport, content, cmView, elementId } = setUp();

    // Uncommitted editor text at gesture time defers resolution to the resolution
    // effect, which runs after the pointer has already been released.
    act(() => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: "\npoint C = coordinate(x: 0 y: -60)" } });
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...B_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 1, ...B_SCREEN });

    await waitFor(() => expect(useCadUiStore.getState().selectedElementId).toBe(elementId("B")));
    await waitFor(() => expect(document.activeElement).toBe(content));
  });

  it("moves focus back to the editor when re-clicking the already-selected element", async () => {
    const { viewport, content } = setUp();

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...AB_MIDPOINT_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 1, ...AB_MIDPOINT_SCREEN });
    await waitFor(() => expect(document.activeElement).toBe(content));

    act(() => content.blur());
    expect(document.activeElement).not.toBe(content);

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 2, ...AB_MIDPOINT_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 2, ...AB_MIDPOINT_SCREEN });
    await waitFor(() => expect(document.activeElement).toBe(content));
  });

  it("does not restore a stale deferred cursor snapshot once Canvas re-selects the same element", async () => {
    const { viewport, content, cmView, elementId } = setUp();

    // Select B, then nudge the CM cursor a couple columns into B's own line
    // without changing the primary selection (still within B's statement range).
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, ...B_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 1, ...B_SCREEN });
    await waitFor(() => expect(document.activeElement).toBe(content));
    const projectedHead = cmView.state.selection.main.head;
    act(() => {
      cmView.dispatch({ selection: { anchor: projectedHead + 2 } });
    });

    // Blur, then mutate B while unfocused so a deferred-cursor snapshot is
    // captured at the nudged (wrong) position.
    act(() => content.blur());
    act(() => {
      const elements = useCadDocumentStore.getState().elements.map((element) =>
        element.id === elementId("B") ? { ...element, locked: true } : element
      );
      useCadDocumentStore.getState().commitDocumentChange({ elements });
    });

    // Select a different element, then re-select B via Canvas: this is a real
    // primary-selection change back to B, so projectPrimaryCursor must run and
    // clear the stale deferred snapshot before the editor is focused again.
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 2, ...AB_MIDPOINT_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 2, ...AB_MIDPOINT_SCREEN });
    await waitFor(() => expect(document.activeElement).toBe(content));

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 3, ...B_SCREEN });
    fireEvent.pointerUp(viewport, { buttons: 0, pointerId: 3, ...B_SCREEN });
    await waitFor(() => expect(document.activeElement).toBe(content));

    // No drag ran here, so this final focus() never hits restoreDeferredExternalCursor's
    // DOM-selection re-read; the cursor should sit exactly at B's fresh projection.
    expect(useCadUiStore.getState().sourceCursorLine).toBe(3);
    expect(cmView.state.selection.main.head).toBe(cmView.state.doc.line(3).from);
  });
});
