import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCommandLineInputComposing,
  setCommandLineInputComposing
} from "../commands/commandLineInputComposition";
import {
  startCommandLineCreation,
  startCommandLineStepEdit
} from "../commands/commandLineSessionCommands";
import { activePickCandidates, applyPickReference } from "../commands/pickCommands";
import { pickRefForOption } from "../model/pickReferences";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { CommandLineBar } from "./CommandLineBar";

// CommandLineBar defers post-edit focus restoration to a real
// requestAnimationFrame in a few places. trackAnimationFrames wraps the
// real rAF - it never runs a callback early or synchronously - so it can
// count every frame that gets scheduled and flush() only resolves once all
// of them have actually fired, inside act(). Tests that depend on a
// post-edit focus restore already await it via waitFor, whose act-wrapping
// spans the whole real-time wait, so plain render() is enough here; only
// the dedicated timing test below needs trackAnimationFrames directly.
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

const renderBar = (props?: ComponentProps<typeof CommandLineBar>) => {
  return render(<CommandLineBar {...props} />);
};

describe("CommandLineBar", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 2", "test");
  });

  afterEach(() => {
    setCommandLineInputComposing(false);
    vi.unstubAllGlobals();
  });

  it("stays absent without a session, focuses on start, and accepts a suggested name on empty Enter", async () => {
    renderBar();
    expect(screen.queryByRole("form", { name: "コマンドライン作成" })).not.toBeInTheDocument();

    act(() => { startCommandLineCreation("freePoint"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.change(input, { target: { value: "rise / 2" } });
    fireEvent.submit(input.closest("form")!);

    const suggestion = input.getAttribute("placeholder");
    expect(suggestion).toBeTruthy();
    fireEvent.submit(input.closest("form")!);
    expect(useCadUiStore.getState().commandLineSession?.args.name).toBe(suggestion);
  });

  it("keeps unnamed creation behind the explicit skip button", () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(input.closest("form")!);

    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("name");
  });

  it("warns about a same-scope duplicate name while it is being entered", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)"
    ].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("freePoint"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "A" } });

    expect(screen.getByRole("alert")).toHaveTextContent("このスコープには「A」という名前の要素が既にあります");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a rejected duplicate name only once", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)"
    ].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("freePoint"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.submit(form);

    expect(screen.getAllByText("このスコープには「A」という名前の要素が既にあります。別の名前を入力してください。")).toHaveLength(1);
  });

  it("separates the active step from recipe-ordered completed progress", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)",
      "line 基準線 = segment(start: A end: B)"
    ].join("\n"), "test");
    const line = useCadDocumentStore.getState().elements.find((item) => item.name === "基準線")!;
    renderBar();
    act(() => { startCommandLineCreation("lineDivisionPoint"); });
    act(() => {
      const session = useCadUiStore.getState().commandLineSession!;
      useCadUiStore.setState({
        commandLineSession: {
          ...session,
          currentStepIndex: 1,
          args: { endpoint: { lineId: line.id, endpointKey: "start" } }
        }
      });
    });

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getAllByText("入力中：割合")).toHaveLength(2);
    expect(screen.getByLabelText("完了済みの入力")).toHaveTextContent("端点");
    expect(screen.getByLabelText("完了済みの入力")).toHaveTextContent("基準線・始点");
    expect(screen.queryByText("endpoint", { exact: true })).not.toBeInTheDocument();
  });

  it("accepts only the shared pick candidates for typed names after Tab, selected empty Enter, and arrow Enter", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)",
      "point = coordinate(x: 200 y: 0)"
    ].join("\n"), "test");
    renderBar();
    const pointA = useCadDocumentStore.getState().elements.find((item) => item.name === "A")!;
    const pointB = useCadDocumentStore.getState().elements.find((item) => item.name === "B")!;
    act(() => { useCadUiStore.getState().setSelectedElementId(pointB.id); });

    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    expect(screen.queryByRole("listbox", { name: "参照候補" })).not.toBeInTheDocument();
    expect(screen.getByText("Canvasで選択できます")).toBeInTheDocument();

    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual({ mode: "reference", pointId: pointB.id });

    fireEvent.change(input, { target: { value: "A" } });
    expect(screen.getByRole("listbox", { name: "参照候補" })).toHaveTextContent("A");
    expect(screen.getByRole("listbox", { name: "参照候補" })).not.toHaveTextContent("point-");
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.args.endPoint).toEqual({ mode: "reference", pointId: pointA.id });
  });

  it("shows the adoptable selected candidate's name only while empty Enter would adopt it", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)",
      "@stop",
      "point C = coordinate(x: 200 y: 0)"
    ].join("\n"), "test");
    renderBar();
    const pointB = useCadDocumentStore.getState().elements.find((item) => item.name === "B")!;
    const pointC = useCadDocumentStore.getState().elements.find((item) => item.name === "C")!;
    act(() => { useCadUiStore.getState().setSelectedElementId(pointB.id); });

    act(() => { startCommandLineCreation("line"); });
    expect(screen.getByText("Enterで選択中を採用：B")).toBeInTheDocument();

    // A typed query takes precedence over selection adoption, so the hint goes away.
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "A" } });
    expect(screen.queryByText(/Enterで選択中を採用/)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Enterで選択中を採用：B")).toBeInTheDocument();

    // An active pick cursor adopts the cursor candidate instead of the selection.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByText(/Enterで選択中を採用/)).not.toBeInTheDocument();
    act(() => { useCadUiStore.getState().setActivePickCursor(null); });

    // Outside the shared candidate set (unevaluated, past @stop) nothing is offered.
    act(() => { useCadUiStore.getState().setSelectedElementId(pointC.id); });
    expect(screen.queryByText(/Enterで選択中を採用/)).not.toBeInTheDocument();
  });

  it("keeps a planned group's first child in the shared name candidates and pick cursor", () => {
    useCadDocumentStore.setState({
      elements: [
        { id: "parent", name: "グループ", type: "group", visible: true, enabled: true },
        {
          id: "first-point", name: "先頭点", type: "freePoint", visible: true, enabled: true,
          parentGroupId: "parent", x: 0, y: 0
        },
        {
          id: "inside", name: "内側", type: "offsetPoint", visible: true, enabled: true,
          parentGroupId: "parent", fromPointId: "first-point", dx: 10, dy: 0
        }
      ],
      evaluationLimitIndex: 3
    });
    useCadUiStore.getState().setGroupFold("parent", { expanded: true });
    renderBar();

    act(() => { startCommandLineCreation("line", { currentCursorElementId: () => "inside" }); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "先頭" } });
    expect(screen.getByRole("listbox", { name: "参照候補" })).toHaveTextContent("先頭点");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useCadUiStore.getState().activePickCursor).toMatchObject({ elementId: "first-point" });
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual({
      mode: "reference",
      pointId: "first-point"
    });
  });

  it("confirms from the real completed-bar Enter path and hands focus back through its command context", async () => {
    const focusSourceEditorAtElementEnd = vi.fn();
    renderBar({ commandContext: { focusSourceEditorAtElementEnd } });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("入力完了。Enterで作成します。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成（Enter）" })).toHaveFocus();
    fireEvent.submit(form);

    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    // confirmCommandLineSession schedules the focus handoff via a real
    // requestAnimationFrame (see commandLineSessionCommands.ts), so it lands
    // after this synchronous submit.
    await waitFor(() => expect(focusSourceEditorAtElementEnd).toHaveBeenCalledOnce());
  });

  it("edits a completed row in place, hides normal back, and restores row focus after commit or cancel", async () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "変数 A" } });
    fireEvent.submit(form);

    const expressionRow = screen.getByRole("button", { name: "式を編集" });
    fireEvent.click(expressionRow);
    const editingInput = screen.getByRole<HTMLInputElement>("textbox");
    await waitFor(() => expect(editingInput).toHaveFocus());
    expect(editingInput).toHaveValue("12");
    expect(screen.getAllByText("編集中：式")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "戻る" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編集をやめる" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "編集をやめる" }));
    await waitFor(() => expect(expressionRow).toHaveFocus());
    expect(useCadUiStore.getState().commandLineSession?.args.expression).toBe(12);

    fireEvent.click(expressionRow);
    fireEvent.change(screen.getByRole<HTMLInputElement>("textbox"), { target: { value: "24" } });
    fireEvent.submit(form);
    await waitFor(() => expect(expressionRow).toHaveFocus());
    expect(useCadUiStore.getState().commandLineSession?.args.expression).toBe(24);
  });

  it("does not restore row focus after an abandoned edit until the deferred frame actually runs", async () => {
    const frames = trackAnimationFrames();
    try {
      render(<CommandLineBar />);
      act(() => { startCommandLineCreation("variable"); });
      const input = screen.getByRole<HTMLInputElement>("textbox");
      const form = input.closest("form")!;
      fireEvent.change(input, { target: { value: "12" } });
      fireEvent.submit(form);
      fireEvent.change(input, { target: { value: "変数 A" } });
      fireEvent.submit(form);

      const expressionRow = screen.getByRole("button", { name: "式を編集" });
      fireEvent.click(expressionRow);
      await frames.flush();

      fireEvent.click(screen.getByRole("button", { name: "編集をやめる" }));
      expect(expressionRow).not.toHaveFocus();

      await frames.flush();
      expect(expressionRow).toHaveFocus();
    } finally {
      frames.restore();
    }
  });

  it("edits completed chips during an unfinished session, keeps a chip switch isolated, and returns focus to the prompt", async () => {
    renderBar();
    act(() => { startCommandLineCreation("freePoint"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 2,
      args: { x: 3, y: 4 }
    });

    fireEvent.click(screen.getByRole("button", { name: "xを編集" }));
    fireEvent.change(screen.getByRole<HTMLInputElement>("textbox"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "yを編集" }));
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({ editingStepIndex: 0, args: { x: 3, y: 4 } });
    expect(screen.getByRole<HTMLInputElement>("textbox")).toHaveValue("10");

    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox")).toHaveFocus());
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 2,
      editingStepIndex: null,
      args: { x: 10, y: 4 }
    });
    expect(screen.getAllByText("入力中：名前")).toHaveLength(2);
  });

  it("returns focus to create when skipping an edited name removes its progress row", async () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "変数 A" } });
    fireEvent.submit(form);

    fireEvent.click(screen.getByRole("button", { name: "名前を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));

    const create = screen.getByRole("button", { name: "作成（Enter）" });
    await waitFor(() => expect(create).toHaveFocus());
    expect(screen.queryByRole("button", { name: "名前を編集" })).not.toBeInTheDocument();
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("name");
  });

  it("keeps the displayed input and session through bar IME events, then resumes after compositionend", () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "未確定" } });
    const session = useCadUiStore.getState().commandLineSession;

    fireEvent.compositionStart(input);
    fireEvent.submit(form);
    fireEvent.keyDown(input, { key: "Escape", isComposing: true, keyCode: 229 });
    expect(startCommandLineCreation("variable")).toBe(false);
    expect(startCommandLineCreation("freePoint")).toBe(false);
    expect(useCadUiStore.getState().commandLineSession).toBe(session);
    expect(input).toHaveValue("未確定");

    fireEvent.compositionEnd(input);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      args: { expression: { kind: "expression", expression: "未確定" } }
    });
  });

  it("does not confirm a completed session during bar IME composition", () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    const completed = useCadUiStore.getState().commandLineSession;
    const confirmButton = screen.getByRole("button", { name: "作成（Enter）" });

    fireEvent.compositionStart(confirmButton);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toBe(completed);
    expect(useCadDocumentStore.getState().elements).toHaveLength(0);

    fireEvent.compositionEnd(confirmButton);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadDocumentStore.getState().elements).toHaveLength(1);
  });

  it("clears the shared bar composition marker when unmounted", () => {
    const view = renderBar();
    act(() => { startCommandLineCreation("variable"); });
    fireEvent.compositionStart(screen.getByRole<HTMLInputElement>("textbox"));
    expect(isCommandLineInputComposing()).toBe(true);

    view.unmount();
    expect(isCommandLineInputComposing()).toBe(false);
  });

  it("clears the shared marker when the session removes the bar form", async () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    fireEvent.compositionStart(screen.getByRole<HTMLInputElement>("textbox"));
    expect(isCommandLineInputComposing()).toBe(true);

    act(() => { useCadUiStore.getState().clearPickMode(); });
    await waitFor(() => expect(isCommandLineInputComposing()).toBe(false));
  });

  it("uses Escape after composition to clear both the session and integrated pick state", () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    act(() => {
      useCadUiStore.getState().setActivePointPickTarget({ elementId: "pick" as never, parameterKey: "value" as never });
    });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
  });

  it("switches between empty Canvas cycling and non-empty text completion after full deletion", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 10 y: 0)"
    ].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    expect(screen.queryByRole("listbox", { name: "参照候補" })).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useCadUiStore.getState().activePickCursor).not.toBeNull();

    fireEvent.change(input, { target: { value: "B" } });
    expect(useCadUiStore.getState().activePickCursor).toBeNull();
    expect(screen.getByRole("listbox", { name: "参照候補" })).toHaveTextContent("B");

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox", { name: "参照候補" })).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useCadUiStore.getState().activePickCursor).not.toBeNull();
  });

  it("uses arrows to select a reference, Enter to reflect it, and a second Enter to adopt its stable pick reference", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point AB = coordinate(x: 10 y: 0)"
    ].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "A" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveClass("active-suggestion");
    expect(options[1]).not.toHaveClass("active-suggestion");

    expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(false);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveClass("active-suggestion");
    expect(options[0]).not.toHaveClass("active-suggestion");
    expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(false);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveClass("active-suggestion");
    expect(options[1]).not.toHaveClass("active-suggestion");
    expect(fireEvent.keyDown(input, { key: "ArrowUp" })).toBe(false);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveClass("active-suggestion");
    expect(options[0]).not.toHaveClass("active-suggestion");
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("startPoint");
    expect(input).toHaveValue("AB");
    expect(screen.queryByRole("listbox", { name: "参照候補" })).toBeNull();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    const pointAB = useCadDocumentStore.getState().elements.find((element) => element.name === "AB")!;
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual({
      mode: "reference",
      pointId: pointAB.id
    });
    expect(input).toHaveFocus();
  });

  it("drops a Tab-reflected reference after any edit and lets Space insert exactly one ordinary character", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point AB = coordinate(x: 10 y: 0)"
    ].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("AB");
    fireEvent.change(input, { target: { value: "ABx" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("startPoint");

    fireEvent.change(input, { target: { value: "A" } });
    expect(screen.getByRole("listbox", { name: "参照候補" })).toBeInTheDocument();
    expect(fireEvent.keyDown(input, { key: " ", code: "Space" })).toBe(true);
    // jsdom does not perform the browser's default text insertion for keydown;
    // model that one normal input event and assert no duplicate space was made.
    fireEvent.change(input, { target: { value: "A " } });
    expect(input).toHaveValue("A ");
    expect(screen.queryByRole("listbox", { name: "参照候補" })).toBeNull();
  });

  it("drops a Tab-reflected reference when Escape cancels the session", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "point A = coordinate(x: 0 y: 0)"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useCadUiStore.getState().commandLineSession).toBeNull();

    act(() => { startCommandLineCreation("line"); });
    const newInput = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(newInput, { target: { value: "A" } });
    fireEvent.keyDown(newInput, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("startPoint");
  });

  it("drops a Tab-reflected reference when retreat returns to its earlier step", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "point A = coordinate(x: 0 y: 0)"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.keyDown(input, { key: "Tab" });

    act(() => {
      const session = useCadUiStore.getState().commandLineSession!;
      useCadUiStore.setState({
        commandLineSession: {
          ...session,
          currentStepIndex: 1,
          args: { startPoint: { mode: "reference", pointId: useCadDocumentStore.getState().elements[0].id } }
        }
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("startPoint");
  });

  it("uses arrows to select a numeric candidate, Tab to reflect it, and Enter to submit it", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "var Width = 10",
      "var Height = 20"
    ].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    let options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    expect(fireEvent.keyDown(input, { key: " ", code: "Space" })).toBe(true);
    fireEvent.change(input, { target: { value: "@ " } });
    expect(input).toHaveValue("@ ");
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();
    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    options = screen.getAllByRole("option");

    expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(false);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(input).toHaveValue("@Height");
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      args: { expression: { kind: "expression", expression: "@Height" } }
    });
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("name");
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();
  });

  it("uses Enter twice to adopt one visible line-list candidate and Mod+Enter to finish the list", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 10 y: 0)",
      "line AB = segment(start: A end: B)"
    ].join("\n"), "test");
    const line = useCadDocumentStore.getState().elements.find((element) => element.name === "AB")!;
    renderBar();
    act(() => { startCommandLineCreation("offsetLine"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "AB" } });

    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("baseLineIds");
    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(0);
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([line.id]);

    expect(fireEvent.keyDown(input, { key: "Enter", metaKey: true })).toBe(false);
    expect(useCadUiStore.getState().commandLineSession?.args.baseLineIds).toEqual([line.id]);
  });

  it("shows the mouse completion action only for a multiple line pick", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 10 y: 0)",
      "line AB = segment(start: A end: B)"
    ].join("\n"), "test");
    renderBar();

    act(() => { startCommandLineCreation("line"); });
    expect(screen.queryByRole("button", { name: "選択を完了" })).toBeNull();
    act(() => { startCommandLineCreation("offsetLine"); });
    expect(screen.getByRole("button", { name: "選択を完了" })).toBeInTheDocument();
  });

  it("keeps Tab inside an open reference list but otherwise falls through from the input", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "point A = coordinate(x: 0 y: 0)"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const session = useCadUiStore.getState().commandLineSession!;
    act(() => {
      useCadUiStore.setState({
        commandLineSession: {
          ...session,
          currentStepIndex: 1,
          args: { startPoint: { mode: "reference", pointId: useCadDocumentStore.getState().elements[0].id } }
        }
      });
    });

    for (const button of [
      screen.getByRole("button", { name: "始点を編集" }),
      screen.getByRole("button", { name: "戻る" }),
      screen.getByRole("button", { name: "キャンセル（Esc）" })
    ]) {
      expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(true);
    }

    fireEvent.change(input, { target: { value: "存在しない候補" } });
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
  });

  it("does not treat IME Enter, Tab, arrows, Escape, or Mod+Enter as assistant operations", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "point A = coordinate(x: 0 y: 0)"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "A" } });
    const session = useCadUiStore.getState().commandLineSession;
    fireEvent.compositionStart(input);

    for (const init of [
      { key: "Enter" },
      { key: "Tab" },
      { key: " ", code: "Space" },
      { key: "ArrowDown" },
      { key: "ArrowUp" },
      { key: "Escape" },
      { key: "Enter", metaKey: true }
    ]) {
      expect(fireEvent.keyDown(input, { ...init, isComposing: true, keyCode: 229 })).toBe(true);
    }
    expect(useCadUiStore.getState().commandLineSession).toBe(session);
    expect(useCadUiStore.getState().activePickCursor).toBeNull();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toMatchObject({ mode: "reference" });
  });

  it("rejects a stable pick reference after the creation session becomes stale", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "point A = coordinate(x: 0 y: 0)"].join("\n"), "test");
    act(() => { startCommandLineCreation("line"); });
    const candidate = activePickCandidates()[0];
    const option = candidate.options[0];
    const ref = pickRefForOption(candidate.elementId, option);
    useCadDocumentStore.setState((state) => ({ sourceRevision: state.sourceRevision + 1 }));

    expect(applyPickReference(ref)).toBe(false);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
  });

  it("uses Escape during a mid-session edit to abandon only that edit", async () => {
    renderBar();
    act(() => { startCommandLineCreation("freePoint"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.submit(input.closest("form")!);
    act(() => { startCommandLineStepEdit(0); });

    fireEvent.keyDown(screen.getByRole<HTMLInputElement>("textbox"), { key: "Escape" });

    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: null,
      args: { x: 3 }
    });
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox", { name: "y" })).toHaveFocus());
  });

  it("keeps completed-session edit Escape as a full session cancellation", () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    fireEvent.click(screen.getByRole("button", { name: "式を編集" }));

    fireEvent.keyDown(screen.getByRole<HTMLInputElement>("textbox"), { key: "Escape" });

    expect(useCadUiStore.getState().commandLineSession).toBeNull();
  });

  it("shows @variable candidates in a number step and narrows them by typed prefix", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "var Width = 10", "var Height = 20"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Height");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    const listbox = screen.getByRole("listbox", { name: "変数候補" });
    expect(listbox).toHaveTextContent("@Width");
    expect(listbox).not.toHaveTextContent("@Height");
  });

  it("replaces only the @token range on selection, leaving surrounding text untouched", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "var Width = 10"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "10 + @Wi" } });
    input.setSelectionRange(8, 8);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole("option", { name: /@Width/ }));

    expect(input).toHaveValue("10 + @Width");
  });

  it("shows the human-readable @name (not an internal id) after selecting a candidate", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "var Width = 10"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole("option", { name: /@Width/ }));

    expect(input).toHaveValue("@Width");
    expect(input.value).not.toMatch(/^@[0-9a-f-]{8,}/);
  });

  it("excludes a variable the evaluator has not computed (e.g. past @stop) from insertion-position candidates", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "var Width = 10"].join("\n"), "test");
    const widthId = useCadDocumentStore.getState().elements.find((element) => element.name === "Width")!.id;

    const { rerender } = renderBar({ evaluation: { computedVariables: new Map(), errors: [], warnings: [], computedGeometry: new Map() } as never });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    rerender(<CommandLineBar evaluation={{
      computedVariables: new Map([[widthId, { kind: "variable", elementId: widthId, name: "Width", value: 10 }]]),
      errors: [],
      warnings: [],
      computedGeometry: new Map()
    } as never} />);
    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");
  });

  it("never shows @variable candidates for name, element-reference, or lineList steps", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "var Width = 10",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)"
    ].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();
  });

  it("does not open @variable candidates during IME composition", () => {
    useCadDocumentStore.getState().commitText(["nui 2", "var Width = 10"].join("\n"), "test");
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");
  });

  const lineGeometryFixture = (elementId: string) => ({
    kind: "line" as const,
    elementId,
    name: "直線AB",
    startPointId: null,
    endPointId: null,
    start: { kind: "point" as const, elementId: "a", name: "a", x: 0, y: 0 },
    end: { kind: "point" as const, elementId: "b", name: "b", x: 10, y: 0 },
    length: 10,
    startAngleDeg: 0,
    endAngleDeg: 0,
    startTangentAngleDeg: 0,
    endTangentAngleDeg: 0
  });

  it("shows AB's referenceable parameters after ElementName. and narrows them by prefix", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)", "line 直線AB = segment(start: A end: B)"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    renderBar({ evaluation });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    const listbox = screen.getByRole("listbox", { name: "変数候補" });
    expect(listbox).toHaveTextContent("length");
    expect(listbox).toHaveTextContent("startTangentAngleDeg");

    fireEvent.change(input, { target: { value: "直線AB.st" } });
    input.setSelectionRange(9, 9);
    fireEvent.select(input);
    const narrowed = screen.getByRole("listbox", { name: "変数候補" });
    expect(narrowed).toHaveTextContent("startTangentAngleDeg");
    expect(narrowed).not.toHaveTextContent("length");
  });

  it("replaces only the member token on selection, leaving ElementName. untouched", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)", "line 直線AB = segment(start: A end: B)"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    renderBar({ evaluation });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "10 + 直線AB.le" } });
    input.setSelectionRange(14, 14);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole("option", { name: /length/ }));

    expect(input).toHaveValue("10 + 直線AB.length");
  });

  it("excludes a disabled/uncomputed element's parameters (evaluation swap)", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)", "line 直線AB = segment(start: A end: B)"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;

    const { rerender } = renderBar({ evaluation: {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map(),
      effectiveEnabledElementIds: new Set()
    } as never });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    rerender(<CommandLineBar evaluation={{
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never} />);
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("never guesses candidates for an ambiguous (duplicate) element name", () => {
    useCadDocumentStore.getState().commitText(
      [
        "nui 2",
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 10 y: 0)",
        "point C = coordinate(x: 20 y: 0)",
        "line 直線AB = segment(start: A end: B id: ab-1)",
        "line 直線AB = segment(start: A end: C id: ab-2)"
      ].join("\n"),
      "test"
    );
    const elements = useCadDocumentStore.getState().elements;
    const duplicates = elements.filter((element) => element.name === "直線AB");
    expect(duplicates).toHaveLength(2);
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map(duplicates.map((element) => [element.id, lineGeometryFixture(element.id)])),
      effectiveEnabledElementIds: new Set(duplicates.map((element) => element.id))
    } as never;

    renderBar({ evaluation });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();
  });

  it("coexists with @variable candidates in the same input without interference", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "var Width = 10", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)", "line 直線AB = segment(start: A end: B)"].join("\n"),
      "test"
    );
    const elements = useCadDocumentStore.getState().elements;
    const abId = elements.find((element) => element.name === "直線AB")!.id;
    const widthId = elements.find((element) => element.name === "Width")!.id;
    const evaluation = {
      computedVariables: new Map([[widthId, { kind: "variable", elementId: widthId, name: "Width", value: 10 }]]),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    renderBar({ evaluation });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");

    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("does not open element-parameter candidates during IME composition", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)", "line 直線AB = segment(start: A end: B)"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    renderBar({ evaluation });
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("immediately clears a displayed session when another document revision arrives", async () => {
    renderBar();
    act(() => { startCommandLineCreation("variable"); });
    expect(screen.getByRole("form", { name: "コマンドライン作成" })).toBeInTheDocument();

    act(() => {
      useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)", "test");
    });
    await waitFor(() => expect(screen.queryByRole("form", { name: "コマンドライン作成" })).not.toBeInTheDocument());
    expect(useCadUiStore.getState().commandErrorMessage).toContain("変更されたため");
  });
});
